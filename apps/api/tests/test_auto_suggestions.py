from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from io import BytesIO
from types import SimpleNamespace
from uuid import UUID, uuid4

import pymupdf
import pytest
from fastapi.testclient import TestClient
from fixtures.build_samples import COMPANY, XLSX, draft_bill, encoded, master, supplier
from openpyxl import Workbook, load_workbook
from sqlalchemy import func, select
from test_phase_three import analysis, apply_master, save
from test_phase_two import finish_queue

from shipping_ai.cdc.importer import WorkbookSelection, parse_selection
from shipping_ai.cdc.master import check_cdc, company_key, parse_master
from shipping_ai.documents.extract import extract
from shipping_ai.review.schemas import EnglishText
from shipping_ai.review.values import field

API = "/api/v1"


def conflicting_case(staff, weight="26.00"):
    from shipping_ai.core.db import session_factory
    from shipping_ai.models import IntakeCase

    with session_factory().begin() as db:
        case = IntakeCase(channel="simulate")
        db.add(case)
        db.flush()
        case_id = str(case.id)
    book = load_workbook(BytesIO(supplier()))
    for sheet in book:
        sheet["B3"] = (
            f"INV-SUGGEST-{uuid4().hex[:8]}"
            if sheet.title == "invoice"
            else book["invoice"]["B3"].value
        )
        sheet["B7"] = "CSQU3054383"
    workbook = encoded(book)
    with pymupdf.open(stream=draft_bill(weight=weight), filetype="pdf") as original:
        text = (
            original[0]
            .get_text()
            .replace("DEMOBL0001", f"SUGGESTBL{uuid4().hex[:8]}")
            .replace("ABCD1234567", "CSQU3054383")
        )
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((50, 60), text)
        bill = pdf.tobytes()
    receipt = staff.post(
        f"{API}/intakes/simulate",
        data={"provider_message_id": uuid4().hex, "intake_case_id": case_id},
        files=[
            ("files", ("invoice.xlsx", workbook, XLSX)),
            ("files", ("bill.pdf", bill, "application/pdf")),
        ],
    )
    assert receipt.status_code == 201, receipt.text
    path = f"{API}/intakes/{receipt.json()['case_id']}"
    finish_queue()
    return path


def archive(staff):
    return conflicting_case(staff, weight="24.00")


def test_source_selection_corrects_reviewed_value_with_citations_and_revision_audit(staff):
    path = conflicting_case(staff)
    current = analysis(staff, path)
    workflow = staff.get(f"{path}/review").json()
    offer = next(
        entry
        for entry in workflow["field_suggestions"]
        if entry["key"] == "transport.gross_weight.invoice"
    )
    source = next(entry for entry in offer["options"] if entry["source"]["role"] == "invoice")
    decision = {
        "key": offer["key"],
        "action": "approved",
        "note": "Checked invoice and packing original; supplier confirmed B/L typo.",
        "source": source["source"],
    }
    reviewed = save(staff, path, current, finding_decisions=[decision])
    assert not any(
        check["field"] == "gross_weight" and check["outcome"] == "MISMATCH"
        for check in reviewed["findings"]
    )
    change = next(
        change for change in reviewed["changes"] if change["edit"]["name"] == "gross_weight"
    )
    assert change["after"]["value"] == "24.00"
    assert change["after"]["evidence"] == source["field"]["evidence"]
    assert change["before"]["value"] == "26"
    again = save(staff, path, current, previous=reviewed["id"], finding_decisions=[decision])
    audit = staff.get(f"{path}/review").json()["finding_audit"]
    assert len(audit) == 1 and audit[0]["stale"] is False
    bill = next(
        doc for doc in staff.get(path).json()["documents"] if doc["mime"] == "application/pdf"
    )
    revision = staff.post(
        f"{API}/intakes/simulate",
        data={"intake_case_id": path.split("/")[-1], "parent_version_id": bill["id"]},
        files={"files": ("corrected.pdf", draft_bill(weight="24.00"), "application/pdf")},
    )
    assert revision.status_code == 201, revision.text
    assert (
        staff.post(
            f"{path}/review",
            json={
                "expected_revision": current["revision"],
                "expected_review_id": again["id"],
                "finding_decisions": [decision],
            },
        ).status_code
        == 409
    )
    finish_queue()
    updated = staff.get(f"{path}/review").json()
    assert updated["review"] is None and updated["finding_audit"][0]["stale"] is True
    assert staff.get(f"{path}/review/{reviewed['id']}").json()["changes"] == reviewed["changes"]


def test_rejecting_or_flagging_a_conflict_cannot_approve_it_and_forged_sources_fail(staff):
    path = conflicting_case(staff)
    current = analysis(staff, path)
    key = "transport.gross_weight.invoice"
    rejected = save(
        staff,
        path,
        current,
        finding_decisions=[{"key": key, "action": "rejected", "note": "Need a corrected B/L"}],
    )
    assert not rejected["ready"] and rejected["blockers"]
    assert (
        staff.post(
            f"{path}/approve",
            json={
                "expected_revision": current["revision"],
                "review_id": rejected["id"],
                "notes": "Attempted unresolved approval",
            },
        ).status_code
        == 409
    )
    forged = {
        "key": key,
        "action": "approved",
        "note": "Fabricated source must fail",
        "source": {
            "document_id": str(uuid4()),
            "role": "invoice",
            "row": None,
            "name": "gross_weight",
        },
    }
    response = staff.post(
        f"{path}/review",
        json={
            "expected_revision": current["revision"],
            "expected_review_id": rejected["id"],
            "finding_decisions": [forged],
        },
    )
    assert response.status_code == 422
    assert staff.get(f"{path}/review").json()["review"]["id"] == rejected["id"]


def test_simultaneous_finding_decisions_use_existing_review_lock(staff):
    path = conflicting_case(staff)
    current = analysis(staff, path)
    payload = {
        "expected_revision": current["revision"],
        "expected_review_id": None,
        "finding_decisions": [
            {
                "key": "transport.gross_weight.invoice",
                "action": "unresolved",
                "note": "Awaiting supplier revision",
            }
        ],
    }
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: staff.post(f"{path}/review", json=payload), range(2)))
    assert sorted(response.status_code for response in results) == [200, 409]
    assert len(staff.get(f"{path}/review").json()["finding_audit"]) == 1


def test_cdc_identity_approval_keeps_shortages_unresolved_without_stock_deduction(staff):
    from shipping_ai.core.db import session_factory
    from shipping_ai.models import CdcMasterVersion, CdcReservation

    path = archive(staff)
    current, _ = apply_master(staff, path, analysis(staff, path), balance="10")
    candidate = current["candidates"][0]
    decision = {
        "key": f"cdc.row.{candidate['invoice_row']}.mapping",
        "action": "approved",
        "master_row": candidate["master_row"],
        "note": "Material matches; shortage still needs a new approval.",
    }
    reviewed = save(staff, path, current, finding_decisions=[decision])
    assert reviewed["mappings"] == [
        {"invoice_row": candidate["invoice_row"], "master_row": candidate["master_row"]}
    ]
    assert reviewed["cdc_ready"] is False and reviewed["permit_pending"]
    assert any(
        check["field"] == "remaining_quantity" and check["outcome"] == "MISMATCH"
        for check in reviewed["cdc_findings"]
    )
    assert any(
        check["field"] == "description" and check["outcome"] == "PASS"
        for check in reviewed["cdc_findings"]
    )
    with session_factory()() as db:
        version = db.get(CdcMasterVersion, UUID(current["analyzed_master"]["id"]))
        assert version.items[0]["remaining_quantity"]["value"] == "10"
        assert (
            db.scalar(
                select(func.count())
                .select_from(CdcReservation)
                .where(CdcReservation.master_id == version.id)
            )
            == 0
        )
    rejected = save(
        staff,
        path,
        current,
        previous=reviewed["id"],
        finding_decisions=[
            {
                **decision,
                "action": "rejected",
                "master_row": None,
                "note": "Wrong material after checking specifications.",
            }
        ],
    )
    assert rejected["mappings"] == [] and not rejected["cdc_ready"]


def test_confirming_cdc_mapping_does_not_replace_original_description(staff):
    path = archive(staff)
    current, _ = apply_master(staff, path, analysis(staff, path))
    candidate = current["candidates"][0]
    reviewed = save(
        staff,
        path,
        current,
        finding_decisions=[
            {
                "key": f"cdc.row.{candidate['invoice_row']}.mapping",
                "action": "approved",
                "master_row": candidate["master_row"],
                "note": "Verified material code and original CDC row.",
            }
        ],
    )
    assert reviewed["cdc_ready"] and reviewed["permit_pending"] is None
    assert reviewed["corrections"] == [] and reviewed["changes"] == []


def test_mapping_fabricated_cdc_row_or_unknown_finding_is_rejected(staff):
    path = archive(staff)
    current, _ = apply_master(staff, path, analysis(staff, path))
    for key, target in (
        ("cdc.row.10.mapping", 4999),
        ("cdc.row.999.mapping", 3),
        ("invented.finding", None),
    ):
        response = staff.post(
            f"{path}/review",
            json={
                "expected_revision": current["revision"],
                "expected_review_id": None,
                "finding_decisions": [
                    {
                        "key": key,
                        "action": "approved",
                        "master_row": target,
                        "note": "Must exist in the analyzed version",
                    }
                ],
            },
        )
        assert response.status_code == 422, response.text


def mapped_workbook():
    book = Workbook()
    sheet = book.active
    sheet.title = "Materials"
    sheet.append(
        ["Material code", "Description", "Unit", "Approved", "Remaining", "Price USD", "HS code"]
    )
    sheet.append(["LAB-1", "Woven label", "PCS", 100, 60, "2.50", "580710"])
    second = book.create_sheet("Next approval")
    for row in sheet.values:
        second.append(row)
    return encoded(book)


def selection(sheet="Materials"):
    return {
        "sheet": sheet,
        "header_row": 1,
        "columns": {
            "item_code": 1,
            "description": 2,
            "unit": 3,
            "approved_quantity": 4,
            "remaining_quantity": 5,
            "unit_price": 6,
            "hs_code": 7,
        },
        "currency": "USD",
    }


def test_mapped_excel_preview_versions_and_original_cell_evidence(staff):
    import json

    data = mapped_workbook()
    upload = {"file": ("materials.xlsx", data, XLSX)}
    assert (
        TestClient(staff.app)
        .post(
            f"{API}/cdc/versions/worksheets",
            files=upload,
            headers={"Origin": "http://localhost:3000"},
        )
        .status_code
        == 401
    )
    catalog = staff.post(f"{API}/cdc/versions/worksheets", files=upload)
    assert catalog.status_code == 200, catalog.text
    assert [sheet["name"] for sheet in catalog.json()] == ["Materials", "Next approval"]
    meta = {
        "company": COMPANY,
        "year": "2026",
        "approval_ref": "MAPPED-2026",
        "verified": "true",
        "balance_as_of": datetime.now(UTC).date().isoformat(),
        "selection": json.dumps(selection()),
    }
    preview = staff.post(
        f"{API}/cdc/versions/preview", data={"selection": meta["selection"]}, files=upload
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["items"][0]["item_code"]["value"] == "LAB-1"
    first = staff.post(f"{API}/cdc/versions", data=meta, files=upload)
    assert first.status_code == 201, first.text
    replay = staff.post(f"{API}/cdc/versions", data=meta, files=upload)
    assert replay.status_code == 200 and replay.json()["id"] == first.json()["id"]
    second = staff.post(
        f"{API}/cdc/versions",
        data={**meta, "selection": json.dumps(selection("Next approval"))},
        files=upload,
    )
    assert second.status_code == 201 and second.json()["id"] != first.json()["id"]
    items = staff.get(f"{API}/cdc/versions/{first.json()['id']}/items").json()["items"]
    assert items[0]["item_code"]["evidence"][0]["cell"] == "A2"
    assert items[0]["description"]["evidence"][0]["sheet"] == "Materials"
    assert staff.get(f"{API}/cdc/versions/{first.json()['id']}/download").content == data


def test_mapped_import_rejects_negative_or_missing_quantity_and_duplicate_columns():
    with pytest.raises(ValueError):
        WorkbookSelection.model_validate(
            {**selection(), "columns": {"description": 2, "unit": 2, "approved_quantity": 4}}
        )
    for quantity in ("-1", "=1+1", None):
        book = load_workbook(BytesIO(mapped_workbook()))
        book.active["D2"] = quantity
        with pytest.raises(ValueError):
            parse_selection(
                encoded(book),
                "materials.xlsx",
                uuid4(),
                WorkbookSelection.model_validate(selection()),
            )


def test_exact_material_code_rank_and_checks_for_selected_alternative():
    invoice = extract(supplier(), "invoice.xlsx", uuid4(), "invoice")[0]
    invoice.items[0].fields["item_code"] = field("LAB-1")
    parsed = parse_selection(
        mapped_workbook(), "materials.xlsx", uuid4(), WorkbookSelection.model_validate(selection())
    )
    exact = parsed.items[0]
    other = exact.model_copy(deep=True)
    other.row = 3
    other.item_code = field("LAB-2")
    other.unit_price = field("9.99", currency="USD", unit="PCS")
    version = SimpleNamespace(
        company=COMPANY,
        company_key=company_key(COMPANY),
        year=2026,
        approval_ref="MAPPED",
        balance_as_of=datetime.now(UTC).date(),
        items=[item.model_dump(mode="json") for item in [exact, other]],
    )
    checks, candidates = check_cdc(invoice, version, selections={10: 3})
    assert candidates[0].master_row == 2 and "Exact material code" in candidates[0].reasons
    price = next(check for check in checks if check.field == "unit_price")
    assert price.outcome == "MISMATCH" and "9.99" in price.right


def test_aggregate_selected_lines_exceed_balance_and_unknown_currency_never_passes():
    invoice = extract(supplier(), "invoice.xlsx", uuid4(), "invoice")[0]
    second = invoice.items[0].model_copy(deep=True)
    second.row = 11
    invoice.items.append(second)
    parsed = parse_master(master(balance="20"), "master.xlsx", uuid4())
    parsed.items[0].unit_price.currency = None
    version = SimpleNamespace(
        company=COMPANY,
        company_key=company_key(COMPANY),
        year=2026,
        approval_ref="MAPPED",
        balance_as_of=datetime.now(UTC).date(),
        items=[item.model_dump(mode="json") for item in parsed.items],
    )
    checks, _ = check_cdc(invoice, version, selections={10: 3, 11: 3})
    assert any(
        check.field == "remaining_quantity"
        and check.outcome == "MISMATCH"
        and check.left.startswith("24")
        for check in checks
    )
    assert all(check.outcome == "NEEDS_REVIEW" for check in checks if check.field == "unit_price")


def test_finding_audit_and_decision_writes_are_workspace_scoped(staff):
    path = conflicting_case(staff)
    current = analysis(staff, path)
    decision = {
        "key": "transport.gross_weight.invoice",
        "action": "unresolved",
        "note": "Waiting for the carrier to correct the source",
    }
    save(staff, path, current, finding_decisions=[decision])
    assert staff.get(f"{path}/review").json()["finding_audit"]
    response = staff.post(f"{API}/workspaces", json={"name": "Unrelated suggestions workspace"})
    assert response.status_code == 201
    assert staff.get(f"{path}/review").status_code == 404
    assert (
        staff.post(
            f"{path}/review",
            json={
                "expected_revision": current["revision"],
                "expected_review_id": None,
                "finding_decisions": [decision],
            },
        ).status_code
        == 404
    )


def test_unknown_multilingual_item_does_not_produce_an_invented_match():
    invoice = extract(supplier(), "invoice.xlsx", uuid4(), "invoice")[0]
    invoice.items[0].fields["description"] = field("氩弧焊机 ZX77")
    invoice.items[0].fields["english_description"] = field(None)
    parsed = parse_master(master(), "master.xlsx", uuid4())
    version = SimpleNamespace(
        company=COMPANY,
        company_key=company_key(COMPANY),
        year=2026,
        approval_ref="MAPPED",
        balance_as_of=datetime.now(UTC).date(),
        items=[item.model_dump(mode="json") for item in parsed.items],
    )
    checks, candidates = check_cdc(invoice, version)
    assert candidates == []
    assert any(
        check.key == "cdc.row.10.unmatched" and check.outcome == "NEEDS_REVIEW" for check in checks
    )
    assert invoice.items[0].fields["description"].value == "氩弧焊机 ZX77"


def test_only_verified_same_company_alias_can_enable_cdc_matching():
    invoice = extract(supplier(), "invoice.xlsx", uuid4(), "invoice")[0]
    company_id = uuid4()
    printed = invoice.fields["consignee"]
    printed.value = "港口示范有限公司"
    parsed = parse_master(master(), "master.xlsx", uuid4())
    version = SimpleNamespace(
        company_id=company_id,
        company=COMPANY,
        company_key=company_key(COMPANY),
        year=2026,
        approval_ref="DEMO",
        balance_as_of=datetime.now(UTC).date(),
        items=[item.model_dump(mode="json") for item in parsed.items],
    )
    printed.english = EnglishText(value=COMPANY, status="proposed", company_id=company_id)
    assert check_cdc(invoice, version)[1] == []
    printed.english.status = "verified_company_alias"
    assert check_cdc(invoice, version)[1]
    version.company_id = uuid4()
    assert check_cdc(invoice, version)[1] == []
