import hashlib
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

from fastapi.testclient import TestClient
from fixtures.build_samples import XLSX, draft_bill, supplier
from test_phase_two import finish_queue

from shipping_ai.core.db import session_factory
from shipping_ai.models import IntakeCase

ROOT = "/api/v1/integrations/folders"
GROUP = hashlib.sha256(b"shipment-alpha").hexdigest()


def test_folder_files_group_deduplicate_and_keep_staff_approval(staff):
    workspace = staff.post("/api/v1/workspaces", json={"name": "Folder intake test"})
    assert workspace.status_code == 201
    company = staff.post("/api/v1/companies", json={"name": "Synthetic factory"}).json()
    other = staff.post("/api/v1/companies", json={"name": "Other factory"}).json()
    source = {"name": "Original Docs", "company_id": company["id"]}
    created = staff.post(ROOT, json=source)
    assert created.status_code == 201
    pairing = created.json()
    source_id = pairing["source_id"]
    assert "key" not in pairing
    assert staff.post(ROOT, json={**source, "name": "Broker Documents"}).status_code == 201
    listed = staff.get(ROOT).json()
    assert [item["name"] for item in listed] == ["Broker Documents", "Original Docs"]
    assert all("key" not in item and item["status"] == "awaiting_setup" for item in listed)

    sheet = supplier()
    bill = draft_bill()
    with TestClient(staff.app, base_url=str(staff.base_url)) as helper:
        paired = helper.post(f"{ROOT}/agent/pair", json=pairing)
        assert paired.status_code == 200
        assert helper.post(f"{ROOT}/agent/pair", json=pairing).status_code == 401
        key = paired.json()["key"]
        headers = {"Authorization": f"Bearer {key}"}

        def upload(name, data, mime, **fields):
            return helper.post(
                f"{ROOT}/agent/upload",
                headers=headers,
                data={"group": GROUP, "subject": "Shipment Alpha", **fields},
                files={"file": (name, data, mime)},
            )

        assert helper.get(f"{ROOT}/agent/config").status_code == 401
        assert helper.get("/api/v1/auth/me", headers=headers).status_code == 401
        assert (
            helper.post(f"{ROOT}/agent/check", headers=headers, json={"status": "ok"}).status_code
            == 204
        )
        assert staff.get(ROOT).json()[1]["status"] == "connected"
        assert upload("wrong.xlsx", b"not an Excel workbook", XLSX).status_code == 415
        assert upload("wrong.xlsx", sheet, XLSX, company_id=other["id"]).status_code == 400
        assert staff.get("/api/v1/intakes?source=folder").json() == []
        with ThreadPoolExecutor(max_workers=2) as executor:
            deliveries = list(
                executor.map(lambda name: upload(name, sheet, XLSX), ["supplier.xlsx"] * 2)
            )
        assert sorted(result.status_code for result in deliveries) == [200, 201]
        case_id = deliveries[0].json()["case_id"]
        assert upload("copy.xlsx", sheet, XLSX).json()["case_id"] == case_id
        followup = upload("bill.pdf", bill, "application/pdf")
        assert followup.status_code == 201 and followup.json()["case_id"] == case_id
        path = f"/api/v1/intakes/{case_id}"
        case = staff.get(path).json()
        assert case["company_id"] == company["id"]
        assert {file["original_filename"] for file in case["documents"]} == {
            "supplier.xlsx",
            "bill.pdf",
        }
        bill_id = next(
            doc["id"] for doc in case["documents"] if doc["original_filename"] == "bill.pdf"
        )
        finish_queue()
        analysis = staff.get(f"{path}/analysis").json()
        assert analysis["state"] == "available"
        assert {doc["role"] for doc in analysis["extractions"]} == {
            "invoice",
            "packing_list",
            "draft_bl",
        }
        assert staff.get(path).json()["state"] == "ready_for_approval"
        assert staff.get(f"/api/v1/documents/{bill_id}/download").content == bill
        assert staff.get("/api/v1/imports").json() == []
        assert staff.get("/api/v1/intakes?source=manual").json() == []

        payload = {**source, "enabled": False}
        assert staff.post(f"{ROOT}/{source_id}/settings", json=payload).status_code == 204
        assert helper.get(f"{ROOT}/agent/config", headers=headers).json()["enabled"] is False
        revised = draft_bill(vessel="Revised fixture vessel")
        assert upload("bill.pdf", revised, "application/pdf").status_code == 409
        assert (
            staff.post(
                f"{ROOT}/{source_id}/settings", json={**payload, "company_id": other["id"]}
            ).status_code
            == 409
        )
        assert (
            staff.post(
                f"{ROOT}/{source_id}/settings", json={**payload, "enabled": True}
            ).status_code
            == 204
        )
        changed = upload("bill.pdf", revised, "application/pdf")
        assert changed.status_code == 201 and changed.json()["case_id"] == case_id
        revision = next(
            doc for doc in staff.get(path).json()["documents"] if doc["parent_version_id"]
        )
        assert revision["parent_version_id"] == bill_id

        with session_factory().begin() as db:
            db.get(IntakeCase, UUID(case_id)).state = "approved"
        later = upload("late.pdf", draft_bill(vessel="Late fixture vessel"), "application/pdf")
        assert later.status_code == 201 and later.json()["case_id"] != case_id
        assert staff.get(path).json()["state"] == "approved"
        old_link = staff.post(f"{ROOT}/{source_id}/pairing").json()
        fresh_link = staff.post(f"{ROOT}/{source_id}/pairing").json()
        assert helper.get(f"{ROOT}/agent/config", headers=headers).status_code == 200
        assert helper.post(f"{ROOT}/agent/pair", json=old_link).status_code == 401
        assert helper.post(f"{ROOT}/agent/pair", json=fresh_link).status_code == 200
        assert helper.get(f"{ROOT}/agent/config", headers=headers).status_code == 401

    assert staff.post("/api/v1/workspaces", json={"name": "Other workspace"}).status_code == 201
    assert staff.get(ROOT).json() == []
    assert staff.post(f"{ROOT}/{source_id}/settings", json=payload).status_code == 404
    assert staff.post(f"{ROOT}/{source_id}/pairing").status_code == 404
    assert staff.post(ROOT, json=source).status_code == 404
