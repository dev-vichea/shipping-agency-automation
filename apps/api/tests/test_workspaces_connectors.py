import base64
from uuid import UUID, uuid4

from conftest import ORIGIN, PASSWORD
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from fixtures.build_samples import COMPANY, XLSX, supplier
from pydantic import AnyHttpUrl, SecretStr
from sqlalchemy import select
from test_phase_three import analysis, apply_master, archive, decision, save
from test_phase_two import finish_queue

API = "/api/v1"


def workspace(staff, name):
    response = staff.post(f"{API}/workspaces", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def new_company(staff, name, **fields):
    response = staff.post(f"{API}/companies", json={"name": name, **fields})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def staff_user():
    from shipping_ai.core.auth import PASSWORD as hasher
    from shipping_ai.core.db import session_factory
    from shipping_ai.models import User

    email = f"ops-{uuid4().hex}@example.com"
    with session_factory().begin() as db:
        staff = User(email=email, password_hash=hasher.hash(PASSWORD))
        db.add(staff)
        db.flush()
    return staff.id, email


def test_workspace_and_company_scope_applies_to_read_and_mutation(staff):
    from shipping_ai.main import app

    first = workspace(staff, "North")
    company_a = new_company(staff, "Factory East")
    company_b = new_company(staff, "Factory West")
    case_a = archive(staff, company_id=company_a)
    case_b = archive(staff, company_id=company_b)
    detail_b = staff.get(case_b).json()
    document_b = detail_b["documents"][0]["id"]
    run_b = staff.get(f"{API}/automation/runs", params={"intake_case_id": detail_b["id"]}).json()[
        0
    ]["id"]
    user_id, email = staff_user()
    assert staff.post(f"{API}/workspace/members", json={"email": email}).status_code == 200
    assert (
        staff.post(
            f"{API}/companies/{company_a}/staff", json={"user_ids": [str(user_id)]}
        ).status_code
        == 204
    )

    with TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN}) as operator:
        assert (
            operator.post(
                f"{API}/auth/login", json={"email": email, "password": PASSWORD}
            ).status_code
            == 200
        )
        assert [row["id"] for row in operator.get(f"{API}/companies").json()] == [company_a]
        assert operator.get(case_a).status_code == 200
        assert operator.get(case_b).status_code == 404
        assert operator.get(f"{case_b}/analysis").status_code == 404
        assert operator.get(f"{case_b}/activity").status_code == 404
        assert operator.get(f"{API}/documents/{document_b}/download").status_code == 404
        assert operator.get(f"{API}/documents/{document_b}/pages/1").status_code == 404
        assert operator.get(f"{API}/automation/runs/{run_b}").status_code == 404
        assert operator.post(f"{API}/automation/runs/{run_b}/retry").status_code == 404
        assert operator.post(f"{case_b}/process", json={"expected_revision": 1}).status_code == 404
        assert (
            operator.post(f"{case_b}/approve", json=decision({"revision": 1}, None)).status_code
            == 404
        )
        assert operator.get(f"{API}/integrations").status_code == 403
        assert operator.post(f"{API}/companies", json={"name": "Other"}).status_code == 403

    second = workspace(staff, "South")
    new_company(staff, "Factory West")  # Name uniqueness is workspace-local.
    assert staff.get(f"{case_b}/review").status_code == 404
    assert staff.get(f"{API}/documents/{document_b}/download").status_code == 404
    assert staff.get(f"{API}/workspace/overview").json()["cases"] == {}
    assert staff.post(f"{API}/workspaces/{first}/select").status_code == 204
    assert staff.get(case_b).status_code == 200
    assert first != second


def test_gmail_oauth_sync_with_replay_and_sender_filter(staff, monkeypatch):
    from shipping_ai.core.config import settings
    from shipping_ai.core.db import session_factory
    from shipping_ai.integrations import gmail
    from shipping_ai.models import GmailConnection

    workspace_id = workspace(staff, "Gmail test")
    company_id = new_company(staff, COMPANY)
    config = settings()
    monkeypatch.setattr(config, "gmail_client_id", "test-client")
    monkeypatch.setattr(config, "gmail_client_secret", SecretStr("synthetic-client-secret"))
    monkeypatch.setattr(config, "connector_key", SecretStr(Fernet.generate_key().decode()))
    content = supplier(packing_quantity=12)
    encoded = base64.urlsafe_b64encode(content).decode().rstrip("=")
    requested = []
    token_body = {"access_token": "synthetic-access", "refresh_token": "synthetic-refresh"}

    def fake_get(_client, _token, path, **_kwargs):
        requested.append(path)
        if path == "profile":
            return {"emailAddress": "operations@example.com", "historyId": "10"}
        if path == "history":
            return {
                "historyId": "12",
                "history": [
                    {
                        "id": "12",
                        "messagesAdded": [
                            {"message": {"id": "ab01"}},
                            {"message": {"id": "ab02"}},
                        ],
                    }
                ],
            }
        sender = "supplier@example.com" if path.endswith("ab01") else "other@example.com"
        return {
            "labelIds": ["INBOX"],
            "internalDate": "1770000000000",
            "threadId": "thread1",
            "payload": {
                "headers": [
                    {"name": "From", "value": sender},
                    {"name": "Subject", "value": "INV-FIXTURE-101"},
                ],
                "parts": [
                    {
                        "filename": "supplier.xlsx",
                        "mimeType": XLSX,
                        "body": {"size": len(content), "data": encoded},
                    }
                ],
            },
        }

    monkeypatch.setattr(gmail, "token", lambda *_args, **_kwargs: token_body)
    monkeypatch.setattr(gmail, "get", fake_get)
    response = staff.post(f"{API}/integrations/gmail/connect")
    assert response.status_code == 200
    assert "code_challenge_method=S256" in response.json()["url"]
    state = staff.cookies.get("shipping_gmail_state")
    assert (
        staff.get(
            f"{API}/integrations/gmail/callback?state={'x' * 43}&code=test", follow_redirects=False
        ).status_code
        == 403
    )
    assert (
        staff.get(
            f"{API}/integrations/gmail/callback?state={state}&code=test", follow_redirects=False
        ).status_code
        == 303
    )
    assert staff.get(f"{API}/integrations").json()["gmail"]["connected"]
    assert (
        staff.post(
            f"{API}/integrations/gmail/settings", json={"enabled": True, "senders": []}
        ).status_code
        == 422
    )
    assert (
        staff.post(
            f"{API}/integrations/gmail/settings",
            json={
                "enabled": True,
                "senders": ["supplier@example.com"],
                "company_id": company_id,
            },
        ).status_code
        == 204
    )

    gmail.sync_workspace(UUID(workspace_id))
    gmail.sync_workspace(UUID(workspace_id))
    finish_queue()
    synced = staff.get(f"{API}/integrations").json()["gmail"]
    assert synced["last_synced_at"] is not None and not synced["error"], synced["error"]
    cases = staff.get(f"{API}/intakes").json()
    assert len(cases) == 1
    assert cases[0]["channel"] == "gmail" and cases[0]["company_id"] == company_id
    assert cases[0]["received_at"].startswith("2026-02-02T02:40:00")
    assert requested.count("messages/ab01") == 1
    assert (
        staff.get(f"{API}/intakes/{cases[0]['id']}").json()["messages"][0]["sender"]
        == "supplier@example.com"
    )
    with session_factory()() as db:
        connection = db.get(GmailConnection, UUID(workspace_id))
        assert connection.history_id == "12"
        assert b"synthetic-refresh" not in connection.credential


def test_telegram_preview_exact_delivery_and_quick_approval_guards(staff, monkeypatch):
    from shipping_ai.core.config import settings
    from shipping_ai.core.db import session_factory
    from shipping_ai.integrations import telegram
    from shipping_ai.models import ReviewSnapshot

    workspace(staff, "Telegram test")
    company = new_company(staff, COMPANY)
    path = archive(staff, company_id=company)
    case_id = UUID(path.split("/")[-1])
    current, mappings = apply_master(staff, path, analysis(staff, path), balance="72")
    review = save(staff, path, current, mappings=mappings, verify_cdc_mappings=True)
    assert review["ready"] and review["permit_pending"] is None

    config = settings()
    monkeypatch.setattr(config, "telegram_bot_token", SecretStr("1234:synthetic_key"))
    sent = []

    def fake_call(method, payload):
        if method == "getChat":
            return {
                "id": int(payload["chat_id"]),
                "type": "private",
                "first_name": "Synthetic Staff",
            }
        sent.append(payload)
        return {"message_id": 77}

    monkeypatch.setattr(telegram, "api", fake_call)
    email = staff.get(f"{API}/auth/me").json()["email"]
    linked = staff.post(
        f"{API}/integrations/telegram/recipients", json={"email": email, "chat_id": "123456"}
    )
    assert linked.status_code == 201, linked.text

    # Exercise the blocked path on a snapshot with findings.
    with session_factory().begin() as db:
        snapshot = db.scalar(
            select(ReviewSnapshot).filter_by(intake_case_id=case_id, revision=current["revision"])
        )
        snapshot.outcome = "MISMATCH"
    assert staff.post(f"{path}/quick-approval", json=decision(current, review)).status_code == 409
    preview = staff.get(f"{path}/telegram").json()
    assert not preview["quick"]
    assert f"{ORIGIN}/open/{case_id}" in preview["message"]
    assert "Invoice: INV-FIXTURE-101" in preview["message"]
    assert "Invoice value: 30.00 USD" in preview["message"], preview["message"]
    assert "Review draft" in preview["message"]
    payload = {
        "recipient_id": linked.json()["id"],
        "revision": preview["revision"],
        "payload_hash": preview["payload_hash"],
    }
    assert (
        staff.post(f"{path}/telegram", json={**payload, "payload_hash": "0" * 64}).status_code
        == 409
    )
    assert sent == []
    first = staff.post(f"{path}/telegram", json=payload)
    assert first.json()["state"] == "sent"
    assert first.json() == staff.post(f"{path}/telegram", json=payload).json()
    assert len(sent) == 1 and sent[0]["text"] == preview["message"]
    assert preview["buttons"] == [] and "reply_markup" not in sent[0]

    https_origin = "https://harborway.example"
    with monkeypatch.context() as secure:
        secure.setattr(config, "web_origin", AnyHttpUrl(https_origin))
        assert staff.get(f"{path}/telegram").json()["buttons"] == ["Review in Telegram"]

    # A deterministic pass can use the same staff approval transaction.
    with session_factory().begin() as db:
        snapshot = db.scalar(
            select(ReviewSnapshot).filter_by(intake_case_id=case_id, revision=current["revision"])
        )
        snapshot.outcome = "PASS"
        snapshot.findings = [
            finding for finding in snapshot.findings if finding["outcome"] == "PASS"
        ]
    assert staff.get(f"{path}/quick-approval").json()["eligible"]

    # HTTPS messages carry version-bound Mini App buttons and require a fresh preview.
    with monkeypatch.context() as secure:
        secure.setattr(config, "web_origin", AnyHttpUrl(https_origin))
        headers = {"Origin": https_origin}
        preview = staff.get(f"{path}/telegram").json()
        assert preview["buttons"] == ["Approve", "Reject"]
        assert staff.post(f"{path}/telegram", json=payload, headers=headers).status_code == 409
        current_payload = {
            **payload,
            "revision": preview["revision"],
            "payload_hash": preview["payload_hash"],
        }
        response = staff.post(f"{path}/telegram", json=current_payload, headers=headers)
        assert response.json()["state"] == "sent"
        [buttons] = sent[-1]["reply_markup"]["inline_keyboard"]
        assert [button["text"] for button in buttons] == preview["buttons"]
        for button in buttons:
            url = button["web_app"]["url"]
            assert url.startswith(f"{https_origin}/open/{case_id}?workspace=")
            assert f"&revision={current['revision']}&review={review['id']}" in url
            assert url.endswith(f"&decision={button['text'].lower()}")

    assert (
        staff.post(
            f"{path}/quick-approval", json={**decision(current, review), "review_id": str(uuid4())}
        ).status_code
        == 409
    )
    approved = staff.post(f"{path}/quick-approval", json=decision(current, review))
    assert approved.status_code == 200, approved.text
    assert approved.json()["decision"] == "approved"
    master = staff.get(f"{API}/cdc/versions").json()[0]["id"]
    rows = staff.get(f"{API}/cdc/versions/{master}/items").json()
    assert rows["internally_reserved"] == {"3": "12.000000"}
    assert rows["items"][0]["remaining_quantity"]["value"] == "72"


def test_telegram_quick_rejection_requires_a_current_eligible_review(staff):
    from shipping_ai.core.db import session_factory
    from shipping_ai.models import ReviewSnapshot

    workspace(staff, "Telegram rejection")
    company = new_company(staff, COMPANY)
    path = archive(staff, company_id=company)
    current, mappings = apply_master(staff, path, analysis(staff, path), balance="72")
    review = save(staff, path, current, mappings=mappings, verify_cdc_mappings=True)
    payload = {**decision(current, review), "notes": "Test rejection requested by staff."}
    with TestClient(staff.app, base_url=ORIGIN) as unsigned:
        assert (
            unsigned.post(
                f"{path}/quick-rejection", json=payload, headers={"Origin": ORIGIN}
            ).status_code
            == 401
        )
    with session_factory().begin() as db:
        snapshot = db.scalar(
            select(ReviewSnapshot).filter_by(
                intake_case_id=UUID(path.rsplit("/", 1)[1]), revision=current["revision"]
            )
        )
        snapshot.outcome = "MISMATCH"
    assert staff.post(f"{path}/quick-rejection", json=payload).status_code == 409
    with session_factory().begin() as db:
        snapshot = db.get(ReviewSnapshot, snapshot.id)
        snapshot.outcome = "PASS"
        snapshot.findings = [
            finding for finding in snapshot.findings if finding["outcome"] == "PASS"
        ]

    assert staff.post(f"{path}/quick-rejection", json={**payload, "notes": ""}).status_code == 422
    stale = {**payload, "expected_revision": current["revision"] - 1}
    assert staff.post(f"{path}/quick-rejection", json=stale).status_code == 409
    stale = {**payload, "review_id": str(uuid4())}
    assert staff.post(f"{path}/quick-rejection", json=stale).status_code == 409
    rejected = staff.post(f"{path}/quick-rejection", json=payload)
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["decision"] == "rejected"
    case = staff.get(path).json()
    assert case["state"] == "rejected" and case["import_id"] is None
    assert not staff.get(f"{path}/quick-approval").json()["eligible"]


def test_password_change_retires_other_sessions_and_preferences_persist(staff):
    from shipping_ai.main import app

    email = staff.get(f"{API}/auth/me").json()["email"]
    with TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN}) as second:
        assert (
            second.post(
                f"{API}/auth/login", json={"email": email, "password": PASSWORD}
            ).status_code
            == 200
        )
        saved = staff.post(
            f"{API}/auth/preferences", json={"approval_alerts": False, "automation_alerts": True}
        )
        assert (
            saved.status_code == 200 and not second.get(f"{API}/auth/me").json()["approval_alerts"]
        )
        new_password = f"fixture-{uuid4().hex}"
        assert (
            staff.post(
                f"{API}/auth/password",
                json={"current_password": "wrong", "new_password": new_password},
            ).status_code
            == 422
        )
        assert (
            staff.post(
                f"{API}/auth/password",
                json={"current_password": PASSWORD, "new_password": new_password},
            ).status_code
            == 204
        )
        assert second.get(f"{API}/auth/me").status_code == 401
        assert staff.get(f"{API}/auth/me").status_code == 200
        assert (
            second.post(
                f"{API}/auth/login", json={"email": email, "password": new_password}
            ).status_code
            == 200
        )


def test_consolidated_approval_revalidates_and_is_idempotent(staff):
    workspace(staff, "Consolidated approval test")
    for packing in (10, 12):
        path = archive(staff, packing=packing)
        revision = analysis(staff, path)["revision"]
        payload = {
            "expected_revision": revision,
            "expected_review_id": None,
            "notes": "Reviewed fixture values.",
        }
        response = staff.post(f"{path}/review-and-approve", json=payload)
        if packing == 10:
            assert response.status_code == 409
            assert staff.get(f"{path}/review").json()["review"] is None
        else:
            assert response.status_code == 200, response.text
            assert staff.post(f"{path}/review-and-approve", json=payload).json() == response.json()
            assert (
                staff.post(
                    f"{path}/review-and-approve", json={**payload, "notes": "Different review."}
                ).status_code
                == 409
            )


def test_telegram_pairing_token_and_update_processing(staff, monkeypatch):
    from pydantic import SecretStr
    from redis import Redis

    from shipping_ai.core.config import settings
    from shipping_ai.core.db import session_factory
    from shipping_ai.integrations import telegram
    from shipping_ai.models import TelegramRecipient

    workspace(staff, "Telegram pairing workspace")
    company = new_company(staff, COMPANY)
    path = archive(staff, company_id=company)
    _case_id = UUID(path.split("/")[-1])

    config = settings()
    monkeypatch.setattr(config, "telegram_bot_token", SecretStr("1234:synthetic_key"))
    sent = []

    def fake_call(method, payload):
        if method == "getMe":
            return {"username": "HarborwayBot", "first_name": "Harborway Bot"}
        if method == "getChat":
            return {
                "id": int(payload["chat_id"]),
                "type": "private",
                "first_name": "Test User",
            }
        sent.append(payload)
        return {"message_id": 99}

    monkeypatch.setattr(telegram, "api", fake_call)

    # 1. Generate pairing token
    res = staff.post(f"{API}/integrations/telegram/pairing-token", json={})
    assert res.status_code == 200, res.text
    pairing = res.json()
    assert pairing["token"] and pairing["bot_username"] == "HarborwayBot"
    assert f"https://t.me/HarborwayBot?start=harborway_{pairing['token']}" == pairing["pairing_url"]

    # 2. Process /start with pairing token
    redis = Redis.from_url(str(settings().redis_url), socket_timeout=2)
    update = {
        "update_id": 1,
        "message": {
            "chat": {
                "id": 987654321,
                "type": "private",
                "first_name": "Vichea",
                "last_name": "Staff",
            },
            "text": f"/start harborway_{pairing['token']}",
        },
    }
    with session_factory().begin() as db:
        processed = telegram.process_update(db, redis, update)
        assert processed is True

    assert any("Account Linked Successfully" in s.get("text", "") for s in sent)

    with session_factory().begin() as db:
        recipient = db.scalar(select(TelegramRecipient).where(TelegramRecipient.chat_id == "987654321"))
        assert recipient is not None
        assert recipient.display_name == "Vichea Staff"

    # 3. Replay with same token should report expired
    sent.clear()
    with session_factory().begin() as db:
        processed = telegram.process_update(db, redis, update)
        assert processed is True
    assert len(sent) == 1
    assert "expired or was already used" in sent[-1]["text"]

    # 4. /whoami check
    sent.clear()
    whoami_update = {
        "update_id": 2,
        "message": {
            "chat": {"id": 987654321, "type": "private"},
            "text": "/whoami",
        },
    }
    with session_factory().begin() as db:
        processed = telegram.process_update(db, redis, whoami_update)
        assert processed is True
    assert len(sent) == 1
    assert "987654321" in sent[-1]["text"]

    # 5. /status check
    sent.clear()
    status_update = {
        "update_id": 3,
        "message": {
            "chat": {"id": 987654321, "type": "private"},
            "text": "/status INV-FIXTURE-101",
        },
    }
    with session_factory().begin() as db:
        processed = telegram.process_update(db, redis, status_update)
        assert processed is True
    assert len(sent) == 1
    assert "Shipping draft" in sent[-1]["text"]
    assert "INV-FIXTURE-101" in sent[-1]["text"]
    buttons = sent[-1].get("reply_markup", {}).get("inline_keyboard", [])
    btn_texts = [b["text"] for row in buttons for b in row]
    assert "📄 Invoice" in btn_texts
    assert "📦 Packing List" in btn_texts
    assert "🚢 B/L" in btn_texts

    # 6. Interactive callback queries for documents
    sent.clear()
    inv_cb = {
        "update_id": 4,
        "callback_query": {
            "id": "cb1",
            "message": {
                "message_id": 42,
                "chat": {"id": 987654321, "type": "private"},
            },
            "data": "doc:inv:INV-FIXTURE-101",
        },
    }
    with session_factory().begin() as db:
        assert telegram.process_update(db, redis, inv_cb) is True
    assert any("Commercial Invoice Details" in s.get("text", "") for s in sent)

    sent.clear()
    pl_cb = {
        "update_id": 5,
        "callback_query": {
            "id": "cb2",
            "message": {
                "message_id": 42,
                "chat": {"id": 987654321, "type": "private"},
            },
            "data": "doc:pl:INV-FIXTURE-101",
        },
    }
    with session_factory().begin() as db:
        assert telegram.process_update(db, redis, pl_cb) is True
    assert any("Packing List Details" in s.get("text", "") for s in sent)

    sent.clear()
    bl_cb = {
        "update_id": 6,
        "callback_query": {
            "id": "cb3",
            "message": {
                "message_id": 42,
                "chat": {"id": 987654321, "type": "private"},
            },
            "data": "doc:bl:INV-FIXTURE-101",
        },
    }
    with session_factory().begin() as db:
        assert telegram.process_update(db, redis, bl_cb) is True
    assert any("Bill of Lading Details" in s.get("text", "") for s in sent)


def test_telegram_status_notifications_on_approval_rejection_and_revision(staff, monkeypatch):
    from shipping_ai.core.config import settings
    from shipping_ai.core.db import session_factory
    from shipping_ai.integrations import telegram
    from shipping_ai.models import ActivityEvent, IntakeCase

    workspace(staff, "Telegram Status Updates Workspace")
    company = new_company(staff, COMPANY)
    path = archive(staff, company_id=company)
    case_id = UUID(path.split("/")[-1])
    current, mappings = apply_master(staff, path, analysis(staff, path), balance="72")
    review = save(staff, path, current, mappings=mappings, verify_cdc_mappings=True)

    config = settings()
    monkeypatch.setattr(config, "telegram_bot_token", SecretStr("1234:status_test_key"))

    calls = []

    def fake_api(method, payload):
        calls.append({"method": method, "payload": payload})
        if method == "getChat":
            return {"id": int(payload["chat_id"]), "type": "private", "first_name": "Ops Staff"}
        return {"message_id": 100 + len(calls)}

    monkeypatch.setattr(telegram, "api", fake_api)

    email = staff.get(f"{API}/auth/me").json()["email"]
    linked = staff.post(
        f"{API}/integrations/telegram/recipients",
        json={"email": email, "chat_id": "55512345"},
    )
    assert linked.status_code == 201

    # Send initial draft notification card
    preview = staff.get(f"{path}/telegram").json()
    send_resp = staff.post(
        f"{path}/telegram",
        json={
            "recipient_id": linked.json()["id"],
            "revision": preview["revision"],
            "payload_hash": preview["payload_hash"],
        },
    )
    assert send_resp.status_code == 200
    assert any(c["method"] == "sendMessage" for c in calls)
    calls.clear()

    # 1. Test Status Notification on Approve
    approved = staff.post(f"{path}/approve", json=decision(current, review))
    assert approved.status_code == 200

    # Verify both editMessageText (to update old card) and sendMessage (to alert staff of approval)
    edit_calls = [c for c in calls if c["method"] == "editMessageText"]
    send_calls = [c for c in calls if c["method"] == "sendMessage"]
    assert len(edit_calls) >= 1
    assert "Approved" in edit_calls[0]["payload"]["text"]

    assert len(send_calls) >= 1
    approval_msg = send_calls[0]["payload"]["text"]
    assert "Shipment Approved" in approval_msg
    assert "INV-FIXTURE-101" in approval_msg
    assert email in approval_msg

    with session_factory().begin() as db:
        event = db.scalar(
            select(ActivityEvent).filter_by(
                intake_case_id=case_id, event_type="telegram_status_approved"
            )
        )
        assert event is not None

    # 2. Test Status Notification on Reject
    calls.clear()
    path2 = archive(staff, company_id=company)
    case_id2 = UUID(path2.split("/")[-1])
    current2, mappings2 = apply_master(staff, path2, analysis(staff, path2), balance="72")
    review2 = save(staff, path2, current2, mappings=mappings2, verify_cdc_mappings=True)

    preview2 = staff.get(f"{path2}/telegram").json()
    staff.post(
        f"{path2}/telegram",
        json={
            "recipient_id": linked.json()["id"],
            "revision": preview2["revision"],
            "payload_hash": preview2["payload_hash"],
        },
    )
    calls.clear()

    reject_notes = "Missing carrier stamp on draft B/L"
    rejected = staff.post(
        f"{path2}/reject", json={**decision(current2, review2), "notes": reject_notes}
    )
    assert rejected.status_code == 200

    reject_sends = [c for c in calls if c["method"] == "sendMessage"]
    assert len(reject_sends) >= 1
    reject_msg = reject_sends[0]["payload"]["text"]
    assert "Shipment Rejected" in reject_msg
    assert reject_notes in reject_msg

    with session_factory().begin() as db:
        reject_event = db.scalar(
            select(ActivityEvent).filter_by(
                intake_case_id=case_id2, event_type="telegram_status_rejected"
            )
        )
        assert reject_event is not None

    # 3. Test Revision Received Notification
    calls.clear()
    with session_factory().begin() as db:
        case = db.get(IntakeCase, case_id)
        count = telegram.notify_case_status(
            db,
            case,
            event_type="revision_received",
            details={
                "version_diff": {
                    "has_revisions": True,
                    "is_final_bl": True,
                    "summary": "Telex release final B/L received",
                }
            },
        )
        assert count >= 1

    revision_sends = [c for c in calls if c["method"] == "sendMessage"]
    assert len(revision_sends) >= 1
    rev_msg = revision_sends[0]["payload"]["text"]
    assert "Document Revision Received" in rev_msg
    assert "Final B/L (Telex / Original) received" in rev_msg

    # 4. Test New Intake Detection Notification on Analysis
    calls.clear()
    path3 = archive(staff, company_id=company)
    case_id3 = UUID(path3.split("/")[-1])
    finish_queue()

    new_intake_sends = [
        c for c in calls if c["method"] == "sendMessage" and "New Shipment Detected" in c["payload"]["text"]
    ]
    assert len(new_intake_sends) >= 1
    new_msg = new_intake_sends[0]["payload"]["text"]
    assert "New Shipment Detected" in new_msg
    assert "INV-FIXTURE-101" in new_msg
    assert "XIN CAI FU" in new_msg or COMPANY in new_msg

    with session_factory().begin() as db:
        new_event = db.scalar(
            select(ActivityEvent).filter_by(
                intake_case_id=case_id3, event_type="telegram_status_new_intake"
            )
        )
        assert new_event is not None

    # 5. Test Invoice Item Formatting (• QTY:, • PRICE:, • AMOUNT:)
    calls.clear()
    with session_factory().begin() as db:
        telegram.handle_document_command(db, "55512345", "inv", "INV-FIXTURE-101")
    inv_sends = [c for c in calls if c["method"] == "sendMessage"]
    assert len(inv_sends) >= 1
    inv_text = inv_sends[0]["payload"]["text"]
    assert "• QTY:" in inv_text
    assert "• PRICE:" in inv_text
    assert "• AMOUNT:" in inv_text

    # 6. Test Packing List Item Formatting (• QTY:, • NW:, • GW:)
    calls.clear()
    with session_factory().begin() as db:
        telegram.handle_document_command(db, "55512345", "pl", "INV-FIXTURE-101")
    pl_sends = [c for c in calls if c["method"] == "sendMessage"]
    assert len(pl_sends) >= 1
    pl_text = pl_sends[0]["payload"]["text"]
    assert "• QTY:" in pl_text
    assert "• GW:" in pl_text


