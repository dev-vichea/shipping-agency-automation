from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from hashlib import sha256
from io import BytesIO
from uuid import uuid4

from fixtures.build_samples import COMPANY, XLSX, draft_bill, master, supplier
from openpyxl import load_workbook
from test_phase_two import finish_queue

API = "/api/v1"
ORIGIN = "http://localhost:3000"


def archive(staff, *, packing=12, missing_ref=False, **metadata):
    response = staff.post(
        f"{API}/intakes/simulate",
        data={"provider_message_id": str(uuid4()), **metadata},
        files=[
            (
                "files",
                (
                    "supplier.xlsx",
                    supplier(packing_quantity=packing, missing_ref=missing_ref),
                    XLSX,
                ),
            ),
            ("files", ("draft.pdf", draft_bill(), "application/pdf")),
        ],
    )
    assert response.status_code == 201
    finish_queue()
    return f"{API}/intakes/{response.json()['case_id']}"


def analysis(staff, path):
    return staff.get(f"{path}/analysis").json()


def save(staff, path, current, previous=None, **extra):
    response = staff.post(
        f"{path}/review",
        json={
            "expected_revision": current["revision"],
            "expected_review_id": previous,
            **extra,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def decision(current, review, notes="Verified against the source files."):
    return {
        "expected_revision": current["revision"],
        "review_id": review["id"] if review else None,
        "notes": notes,
    }


def apply_master(staff, path, current, *, balance="60"):
    response = staff.post(
        f"{API}/cdc/versions",
        data={
            "company": COMPANY,
            "year": "2026",
            "approval_ref": "DEMO-2026",
            "verified": "true",
            "balance_as_of": datetime.now(UTC).date().isoformat(),
        },
        files={"file": ("master.xlsx", master(balance=balance), XLSX)},
    )
    assert response.status_code in {200, 201}, response.text
    assert (
        staff.post(
            f"{path}/cdc-version",
            json={
                "expected_revision": current["revision"],
                "version_id": response.json()["id"],
            },
        ).status_code
        == 202
    )
    finish_queue()
    updated = analysis(staff, path)
    mappings = [
        {"invoice_row": row["invoice_row"], "master_row": row["master_row"]}
        for row in updated["candidates"]
    ]
    assert mappings
    return updated, mappings


def test_approval_updates_existing_draft_once_and_produces_auditable_workbooks(staff, api):
    path = archive(staff)
    case = staff.get(path).json()
    assert case["state"] == "ready_for_approval"
    existing = staff.post(
        f"{API}/imports",
        json={
            "intake_case_id": case["id"],
            "company": COMPANY,
            "invoice_no": "OLD-DRAFT",
        },
    ).json()
    current, mappings = apply_master(staff, path, analysis(staff, path))
    review = save(staff, path, current, mappings=mappings, verify_cdc_mappings=True)
    assert review["ready"]
    payload = decision(current, review)
    assert (
        staff.post(
            f"{path}/approve", json=payload, headers={"Origin": "https://example.invalid"}
        ).status_code
        == 403
    )
    with ThreadPoolExecutor(max_workers=2) as executor:
        a, b = executor.map(lambda _: staff.post(f"{path}/approve", json=payload), range(2))
    assert a.status_code == b.status_code == 200
    assert a.json() == b.json()
    assert a.json()["permit_pending"] is None
    assert a.json()["import_id"] == existing["id"]
    record_path = f"{API}/imports/{existing['id']}"
    record = staff.get(record_path).json()
    assert record["state"] == "approved" and record["etd"] is None and record["eta"] is None
    assert record["items"][0]["amount"] == "30.000000"
    assert record["items"][0]["source_document_id"] in {doc["id"] for doc in case["documents"]}
    drafts = staff.get(f"{record_path}/permit-drafts").json()
    assert len(drafts) == 1 and drafts[0]["current"] and drafts[0]["recipient"] is None
    draft_path = f"{record_path}/permit-drafts/{drafts[0]['id']}"
    response = staff.get(f"{draft_path}/download")
    assert sha256(response.content).hexdigest() == drafts[0]["sha256"]
    workbook = load_workbook(BytesIO(response.content))
    assert workbook.sheetnames == ["INV", "PL"]
    assert "DRAFT" in workbook["INV"]["A1"].value
    assert workbook["INV"]["G12"].value == 30
    assert workbook["INV"]["A12"].value == "#1"
    workbook.close()
    release = {"recipient": "broker@example.com", "notes": "Test authorization."}
    sent = staff.post(f"{draft_path}/release", json=release)
    assert sent.json()["state"] == "authorized"
    assert staff.post(f"{draft_path}/release", json=release).json() == sent.json()
    assert (
        staff.post(
            f"{draft_path}/release", json={**release, "recipient": "different@example.com"}
        ).status_code
        == 409
    )
    events = staff.get(f"{path}/review").json()["decisions"]
    assert {event["scope"] for event in events} == {"intake", "permit_release"}
    assert (
        next(e for e in events if e["scope"] == "intake")["snapshot_hash"]
        == review["snapshot_hash"]
    )
    report = staff.get(f"{API}/reports/imports").json()
    row = next(row for row in report["rows"] if row["id"] == existing["id"])
    assert row["currency"] == "USD" and row["amount"] == "30.000000"
    workbook = load_workbook(BytesIO(staff.get(f"{API}/reports/imports?excel=true").content))
    assert "OLD-DRAFT" not in {row[0] for row in workbook["Approved imports"].values}
    assert existing["id"] in {row[-1] for row in workbook["Approved imports"].values}
    workbook.close()


def test_conflict_requires_field_correction_and_stale_approval_is_rejected(staff):
    path = archive(staff, packing=10)
    current = analysis(staff, path)
    original = next(doc for doc in current["extractions"] if doc["role"] == "packing_list")
    review = save(staff, path, current)
    assert not review["ready"]
    assert staff.post(f"{path}/approve", json=decision(current, review)).status_code == 409
    response = staff.post(
        f"{path}/review",
        json={
            "expected_revision": current["revision"],
            "expected_review_id": review["id"],
            "resolutions": [{"key": "invoice_packing.quantity.10.11", "note": "ignore"}],
        },
    )
    assert response.status_code == 422
    correction = {
        "document_id": original["document_id"],
        "role": "packing_list",
        "row": original["items"][0]["row"],
        "name": "quantity",
        "value": "12",
        "note": "Checked the corrected quantity with the supplier.",
    }
    corrected = save(staff, path, current, review["id"], corrections=[correction])
    assert corrected["ready"]
    assert staff.post(f"{path}/approve", json=decision(current, review)).status_code == 409
    result = staff.post(f"{path}/approve", json=decision(current, corrected)).json()
    assert result["decision"] == "approved" and result["permit_pending"]
    assert staff.get(f"{API}/imports/{result['import_id']}/permit-drafts").json() == []
    untouched = next(
        doc for doc in analysis(staff, path)["extractions"] if doc["role"] == "packing_list"
    )
    assert untouched["items"][0]["fields"]["quantity"]["value"] == "10"


def test_missing_ref_correction_request_rejection_and_unauthorized_approval(staff):
    import httpx

    path = archive(staff, missing_ref=True)
    current = analysis(staff, path)
    with httpx.Client(
        transport=staff._transport, base_url=ORIGIN, headers={"Origin": ORIGIN}
    ) as unauthenticated:
        assert (
            unauthenticated.post(f"{path}/approve", json=decision(current, None)).status_code == 401
        )
    review = save(
        staff, path, current, request_correction="Ask staff to verify the invoice number."
    )
    assert not review["ready"] and "correction" in review["blockers"][0]
    payload = decision(current, review, "Missing invoice reference.")
    result = staff.post(f"{path}/reject", json=payload).json()
    assert result["decision"] == "rejected" and result["import_id"] is None
    assert staff.post(f"{path}/reject", json=payload).json() == result
    assert staff.get(path).json()["state"] == "rejected"
    assert staff.post(f"{path}/approve", json=payload).status_code == 409
    assert staff.get(path).json()["documents"]


def test_unknown_balance_keeps_permit_pending(staff):
    path = archive(staff)
    current, mappings = apply_master(staff, path, analysis(staff, path), balance="=G3-5")
    review = save(staff, path, current, mappings=mappings, verify_cdc_mappings=True)
    result = staff.post(f"{path}/approve", json=decision(current, review)).json()
    assert result["decision"] == "approved"
    assert "unknown" in result["permit_pending"]
    assert staff.get(f"{API}/imports/{result['import_id']}/permit-drafts").json() == []


def test_reapproval_keeps_original_decision_and_replaces_current_items(staff):
    path = archive(staff)
    first = analysis(staff, path)
    initial = save(staff, path, first)
    accepted = staff.post(f"{path}/approve", json=decision(first, initial)).json()
    assert accepted["decision"] == "approved"
    updated = staff.post(f"{path}/process", json={"expected_revision": first["revision"]})
    assert updated.status_code == 202
    finish_queue()
    current = analysis(staff, path)
    second = save(staff, path, current)
    confirmed = staff.post(f"{path}/approve", json=decision(current, second)).json()
    assert confirmed["import_id"] == accepted["import_id"]
    assert confirmed["approval_id"] != accepted["approval_id"]
    assert staff.post(f"{path}/approve", json=decision(first, initial)).json() == accepted
    assert (
        staff.get(f"{path}/review/{initial['id']}").json()["snapshot_hash"]
        == initial["snapshot_hash"]
    )
    assert len(staff.get(f"{API}/imports/{accepted['import_id']}").json()["items"]) == 1
