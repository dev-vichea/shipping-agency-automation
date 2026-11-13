from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from conftest import ORIGIN
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

API = "/api/v1"
PDF = b"%PDF-1.4\nSynthetic test document\n%%EOF\n"


def arrival(client, *, key=None, name="fixture.pdf", body=PDF, **metadata):
    return client.post(
        f"{API}/intakes/simulate",
        data={"provider_message_id": key or uuid4().hex, **metadata},
        files={"files": (name, body, "application/pdf")},
    )


def test_archive_replay_revision_and_download(staff):
    key = uuid4().hex
    first = arrival(staff, key=key, name="../../fixture.pdf", subject="Synthetic arrival")
    assert first.status_code == 201, first.text
    case_id = first.json()["case_id"]
    replay = arrival(staff, key=key, name="../../fixture.pdf", subject="Synthetic arrival")
    assert replay.status_code == 200
    assert replay.json() == {**first.json(), "replayed": True}
    assert (
        arrival(staff, key=key, body=PDF + b"changed", subject="Synthetic arrival").status_code
        == 409
    )

    duplicate = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Duplicate attachments"},
        files=[
            ("files", ("one.pdf", PDF, "application/pdf")),
            ("files", ("two.pdf", PDF, "application/pdf")),
        ],
    )
    assert duplicate.status_code == 201
    assert staff.get(f"{API}/intakes/{duplicate.json()['case_id']}").json()["attachment_count"] == 1

    case = staff.get(f"{API}/intakes/{case_id}").json()
    original = case["documents"][0]
    assert case["detected_reference"] is None
    assert case["import_id"] is None
    assert original["original_filename"] == "fixture.pdf"
    assert original["source_message_id"] == case["messages"][0]["id"]

    path = f"{API}/documents/{original['id']}/download"
    assert TestClient(staff.app).get(path).status_code == 401
    assert staff.get(path).content == PDF
    assert staff.get(path, headers={"Range": "bytes=0-4"}).content == b"%PDF-"
    assert staff.get(path).headers["cache-control"] == "no-store"
    assert staff.get(path).headers["content-disposition"].startswith("attachment;")

    revised = arrival(
        staff,
        intake_case_id=case_id,
        parent_version_id=original["id"],
        body=PDF + b"revised",
        classification="draft_bl",
    )
    assert revised.status_code == 201, revised.text
    docs = staff.get(f"{API}/intakes/{case_id}").json()["documents"]
    assert len(docs) == 2
    assert docs[0]["parent_version_id"] == original["id"]
    assert docs[0]["sha256"] != original["sha256"]
    assert staff.get(path).content == PDF
    assert (
        arrival(
            staff,
            intake_case_id=duplicate.json()["case_id"],
            parent_version_id=original["id"],
            body=PDF + b"wrong case",
        ).status_code
        == 422
    )


def test_concurrent_replay_is_one_case(staff):
    key = uuid4().hex
    cookies = dict(staff.cookies)

    def upload():
        with TestClient(
            staff.app, base_url=ORIGIN, headers={"Origin": ORIGIN}, cookies=cookies
        ) as c:
            return arrival(c, key=key)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: upload(), range(2)))
    assert sorted(r.status_code for r in results) == [200, 201]
    assert len({r.json()["case_id"] for r in results}) == 1
    assert len({r.json()["run_id"] for r in results}) == 1


def test_import_drafts_only(staff):
    from shipping_ai.core.db import session_factory
    from shipping_ai.models import ImportRecord

    first = arrival(staff).json()
    second = arrival(staff).json()
    payload = {
        "intake_case_id": first["case_id"],
        "invoice_no": "FIXTURE-001",
        "company": "Fixture Co",
    }
    assert staff.get(f"{API}/intakes/{first['case_id']}").json()["import_id"] is None
    assert staff.post(f"{API}/imports", json={**payload, "state": "accepted"}).status_code == 422
    assert (
        staff.post(
            f"{API}/imports", json=payload, headers={"Origin": "https://example.org"}
        ).status_code
        == 403
    )
    created = staff.post(f"{API}/imports", json=payload)
    assert created.status_code == 201, created.text
    record = created.json()
    assert record["state"] == "draft"
    assert record["eta"] is None and record["eta_status"] == "pending"
    assert staff.post(f"{API}/imports", json=payload).status_code == 409
    repeat = staff.post(f"{API}/imports", json={**payload, "intake_case_id": second["case_id"]})
    assert repeat.status_code == 201
    assert repeat.json()["id"] != record["id"]
    details = staff.get(f"{API}/imports/{record['id']}").json()
    assert details["documents"][0]["sha256"]
    assert details["items"] == []
    assert any(row["id"] == record["id"] for row in staff.get(f"{API}/imports").json())
    with pytest.raises(IntegrityError), session_factory().begin() as db:
        db.execute(
            update(ImportRecord)
            .where(ImportRecord.id == UUID(record["id"]))
            .values(state="accepted")
        )


def test_upload_bounds_and_session_revocation(staff):
    from shipping_ai.core.db import session_factory
    from shipping_ai.models import User

    assert arrival(staff, body=b"<html>not a PDF").status_code == 415
    assert arrival(staff, name="fixture.xlsm").status_code == 415
    assert arrival(staff, body=PDF + bytes(8192)).status_code == 413
    assert staff.post(f"{API}/intakes/simulate", content=b"z" * (180 * 1024)).status_code == 413

    def chunks():
        yield b'--shipping-fixture\r\nContent-Disposition: form-data; name="files"; filename="fixture.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-'
        yield b"a" * (180 * 1024)
        yield b"\r\n--shipping-fixture--\r\n"

    assert (
        staff.post(
            f"{API}/intakes/simulate",
            content=chunks(),
            headers={
                "Content-Type": "multipart/form-data; boundary=shipping-fixture",
            },
        ).status_code
        == 413
    )
    email = staff.get(f"{API}/auth/me").json()["email"]
    with session_factory().begin() as db:
        db.execute(update(User).where(User.email == email).values(active=False))
    assert staff.get(f"{API}/intakes").status_code == 401
    assert arrival(staff).status_code == 401


def test_worker_retries_and_respects_stale_lease(staff):
    from shipping_ai.automation.tasks import MAX_RETRIES, claim, drain, finish
    from shipping_ai.core.config import settings
    from shipping_ai.core.db import session_factory
    from shipping_ai.documents.storage import LocalStorage
    from shipping_ai.models import AutomationRun

    # Finish pending fixtures to isolate the new queue entry.
    while (pending := claim()) is not None:
        finish(pending, None)
    data = arrival(staff, body=PDF + b"retry fixture").json()
    run_id = UUID(data["run_id"])
    doc = staff.get(f"{API}/intakes/{data['case_id']}").json()["documents"][0]
    blob = LocalStorage(settings().storage_dir).path(doc["sha256"])
    stored = blob.read_bytes()
    blob.unlink()
    old = claim()
    with session_factory().begin() as db:
        db.get(AutomationRun, run_id).lease_until = datetime.now(UTC) - timedelta(seconds=1)
    new = claim()
    assert new.id == old.id and new.attempt > old.attempt
    finish(old, None)
    finish(new, "attachment_unavailable")
    for _ in range(MAX_RETRIES + 1):
        with session_factory().begin() as db:
            db.get(AutomationRun, run_id).available_at = datetime.now(UTC)
        drain.run()
    with session_factory()() as db:
        run = db.get(AutomationRun, run_id)
        assert run.state == "failed" and run.error_code == "attachment_unavailable"
        trace = run.trace_id
    assert staff.get(f"{API}/intakes/{data['case_id']}").json()["state"] == "failed"
    blob.write_bytes(stored)
    assert staff.post(f"{API}/automation/runs/{run_id}/retry").status_code == 202
    assert staff.post(f"{API}/automation/runs/{run_id}/retry").status_code == 202
    drain.run()
    with session_factory()() as db:
        run = db.get(AutomationRun, run_id)
        assert run.state == "succeeded" and run.trace_id == trace
    drain.run()  # The successful receipt queues document analysis.
    assert staff.get(f"{API}/intakes/{data['case_id']}").json()["state"] == "needs_review"

    job = staff.post(f"{API}/automation/health-check")
    assert job.status_code == 202
    drain.run()
    with session_factory()() as db:
        assert (
            db.scalar(select(AutomationRun.state).where(AutomationRun.id == UUID(job.json()["id"])))
            == "succeeded"
        )


def test_xlsx_allowlist_and_plain_message(staff):
    from io import BytesIO
    from zipfile import ZipFile

    def workbook(*, macros: bool):
        stream = BytesIO()
        with ZipFile(stream, "w") as archive:
            archive.writestr("[Content_Types].xml", "<Types/>")
            archive.writestr("xl/workbook.xml", "<workbook/>")
            if macros:
                archive.writestr("xl/vbaProject.bin", b"synthetic placeholder")
        return stream.getvalue()

    mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    for macros, code in ((False, 201), (True, 415)):
        payload = workbook(macros=macros)
        response = staff.post(
            f"{API}/intakes/simulate",
            data={"classification": "invoice"},
            files={"files": ("invoice.xlsx", payload, mime)},
        )
        assert response.status_code == code, response.text
        if code == 201:
            case = staff.get(f"{API}/intakes/{response.json()['case_id']}").json()
            assert case["documents"][0]["mime"] == mime
            assert case["documents"][0]["classification"] == "invoice"
    message = staff.post(
        f"{API}/intakes/simulate", files={"body": (None, "Awaiting supplier files.")}
    )
    assert message.status_code == 201
    assert staff.get(f"{API}/intakes/{message.json()['case_id']}").json()["attachment_count"] == 0
    assert arrival(staff, subject="NUL\x00character").status_code == 422
