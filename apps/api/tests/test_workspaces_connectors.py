import base64
from uuid import UUID, uuid4

from conftest import ORIGIN, PASSWORD
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from fixtures.build_samples import COMPANY, XLSX, supplier
from pydantic import SecretStr
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
