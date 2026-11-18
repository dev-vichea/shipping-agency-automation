from io import BytesIO
from pathlib import Path

import pymupdf
import pytest
from fixtures.build_samples import COMPANY, SUPPLIER, draft_bill, supplier
from openpyxl import Workbook
from test_phase_two import finish_queue

API = "/api/v1"
REAL_SAMPLE_DIR = Path(
    "/Users/kiddd/Library/CloudStorage/GoogleDrive-vicheachheng001@gmail.com/My Drive/SHIPPING/IMPORT/2026/ORIGINAL DOCS/9-CT2611010"
)


def make_pdf_bl(
    *,
    bl_no="DEMOBL0001",
    shipper=SUPPLIER,
    consignee=COMPANY,
    container=None,
    seal="DEMOSEAL1",
    weight="100.00",
    packages=10,
    vessel=None,
    is_telex=False,
    invoice_no=None,
):
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        lines = [
            "BILL OF LADING",
            *([ "TELEX RELEASE" ] if is_telex else []),
            f"B/L No: {bl_no}",
            f"Shipper: {shipper}",
            f"Consignee: {consignee}",
            "Port of Loading: Shanghai",
            "Port of Discharge: Sihanoukville",
            *([f"Container No: {container}"] if container else []),
            f"Seal No: {seal}",
            f"Packages: {packages} PKG",
            f"Gross Weight: {weight} KG",
            "Net Weight: 90.00 KG",
            "BY SEA",
            "Description of Goods: Synthetic garment fabric",
            *([f"Vessel: {vessel}"] if vessel else []),
            *([f"Invoice Ref: {invoice_no}"] if invoice_no else []),
        ]
        page.insert_text((50, 60), "\n".join(lines))
        return pdf.tobytes()


def make_invoice_xlsx(*, invoice_no="INV-2026-001", container=None, weight="100.00", packages=10):
    wb = Workbook()
    ws_inv = wb.active
    ws_inv.title = "INVOICE"
    ws_inv["A1"] = "COMMERCIAL INVOICE"
    ws_inv["A2"] = "Invoice No:"
    ws_inv["B2"] = invoice_no
    ws_inv["A3"] = "Shipper:"
    ws_inv["B3"] = SUPPLIER
    ws_inv["A4"] = "Consignee:"
    ws_inv["B4"] = COMPANY
    if container:
        ws_inv["A5"] = "Container:"
        ws_inv["B5"] = container
    ws_inv["A8"] = "Item"
    ws_inv["B8"] = "Description"
    ws_inv["C8"] = "Qty"
    ws_inv["D8"] = "Unit"
    ws_inv["E8"] = "Price"
    ws_inv["F8"] = "Amount"
    ws_inv["A9"] = 1
    ws_inv["B9"] = "Synthetic garment fabric"
    ws_inv["C9"] = 100
    ws_inv["D9"] = "MTR"
    ws_inv["E9"] = 2.50
    ws_inv["F9"] = 250.00

    ws_pk = wb.create_sheet("PACKING LIST")
    ws_pk["A1"] = "PACKING LIST"
    ws_pk["A2"] = "Invoice No:"
    ws_pk["B2"] = invoice_no
    ws_pk["A8"] = "Item"
    ws_pk["B8"] = "Description"
    ws_pk["C8"] = "Qty"
    ws_pk["D8"] = "Packages"
    ws_pk["E8"] = "Gross Weight"
    ws_pk["A9"] = 1
    ws_pk["B9"] = "Synthetic garment fabric"
    ws_pk["C9"] = 100
    ws_pk["D9"] = f"{packages} PKG"
    ws_pk["E9"] = f"{weight} KG"

    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def test_duplicate_document_handling(staff):
    sheet = make_invoice_xlsx(invoice_no="INV-DUP-001", container="DUPU1000001")
    bill = make_pdf_bl(bl_no="BL-DUP-001", invoice_no="INV-DUP-001", container="DUPU1000001")

    res = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Arrival INV-DUP-001"},
        files=[
            ("files", ("invoice.xlsx", sheet, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
            ("files", ("draft.pdf", bill, "application/pdf")),
        ],
    )
    assert res.status_code == 201
    case_id = res.json()["case_id"]
    finish_queue()

    case_before = staff.get(f"{API}/intakes/{case_id}").json()
    assert len(case_before["documents"]) == 2

    res2 = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Duplicate bill arrival BL-DUP-001"},
        files=[("files", ("draft_duplicate.pdf", bill, "application/pdf"))],
    )
    assert res2.status_code in (200, 201)
    finish_queue()

    case_after = staff.get(f"{API}/intakes/{case_id}").json()
    assert len(case_after["documents"]) == 2


def test_draft_bl_revision_attachment_and_diff(staff):
    sheet = make_invoice_xlsx(invoice_no="INV-REV-001", container="TGHU1234567", weight="100.00")
    bill_v1 = make_pdf_bl(
        bl_no="BL-REV-001",
        invoice_no="INV-REV-001",
        container="TGHU1234567",
        weight="100.00",
        vessel=None,
    )

    res1 = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Initial documents for INV-REV-001"},
        files=[
            ("files", ("invoice.xlsx", sheet, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
            ("files", ("draft_v1.pdf", bill_v1, "application/pdf")),
        ],
    )
    assert res1.status_code == 201
    case_id = res1.json()["case_id"]
    finish_queue()

    case1 = staff.get(f"{API}/intakes/{case_id}").json()
    assert len(case1["documents"]) == 2
    bl_doc_v1 = next(d for d in case1["documents"] if d["original_filename"] == "draft_v1.pdf")
    assert bl_doc_v1["version_number"] == 1
    assert bl_doc_v1["parent_version_id"] is None

    bill_v2 = make_pdf_bl(
        bl_no="BL-REV-001",
        invoice_no="INV-REV-001",
        container="TGHU9876543",
        weight="120.00",
        vessel="EVER GIVEN",
    )
    res2 = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Revised Draft BL-REV-001 attached"},
        files=[("files", ("draft_v2.pdf", bill_v2, "application/pdf"))],
    )
    assert res2.status_code in (200, 201)
    finish_queue()

    case2 = staff.get(f"{API}/intakes/{case_id}").json()
    assert len(case2["documents"]) == 3
    bl_doc_v2 = next(d for d in case2["documents"] if d["original_filename"] == "draft_v2.pdf")
    assert bl_doc_v2["version_number"] == 2
    assert bl_doc_v2["parent_version_id"] == bl_doc_v1["id"]

    analysis = staff.get(f"{API}/intakes/{case_id}/analysis").json()
    assert "version_diff" in analysis and analysis["version_diff"] is not None
    v_diff = analysis["version_diff"]
    assert v_diff["has_revisions"] is True
    diff_entry = next(d for d in v_diff["diffs"] if d["document_id"] == bl_doc_v2["id"])
    assert diff_entry["version_number"] == 2
    assert "container" in diff_entry["modified"]
    assert diff_entry["modified"]["container"]["old"] == "TGHU1234567"
    assert diff_entry["modified"]["container"]["new"] == "TGHU9876543"
    assert "vessel" in diff_entry["added"]
    assert diff_entry["added"]["vessel"] == "EVER GIVEN"


def test_multi_identifier_matching_logic(staff):
    sheet = make_invoice_xlsx(invoice_no="INV-MULTI-001", container="MSKU1122334")
    res = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Booking Advice MSKU1122334"},
        files=[("files", ("invoice.xlsx", sheet, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))],
    )
    assert res.status_code == 201
    case_id = res.json()["case_id"]
    finish_queue()

    bill = make_pdf_bl(bl_no="BL-MULTI-NEW", container="MSKU1122334")
    res_bill = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "B/L for container MSKU1122334"},
        files=[("files", ("draft.pdf", bill, "application/pdf"))],
    )
    assert res_bill.status_code in (200, 201)
    finish_queue()

    case = staff.get(f"{API}/intakes/{case_id}").json()
    assert any(d["original_filename"] == "draft.pdf" for d in case["documents"])


def test_uncertain_matching_and_manual_linking(staff):
    sheet_a = make_invoice_xlsx(invoice_no="INV-A-100", container="MSKU1111111")
    res_a = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Shipment A"},
        files=[("files", ("inv_a.xlsx", sheet_a, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))],
    )
    assert res_a.status_code == 201
    case_a_id = res_a.json()["case_id"]

    sheet_b = make_invoice_xlsx(invoice_no="INV-B-200", container="MSKU2222222")
    res_b = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Shipment B"},
        files=[("files", ("inv_b.xlsx", sheet_b, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))],
    )
    assert res_b.status_code == 201
    assert res_b.json()["case_id"]
    finish_queue()

    bill_conflicting = make_pdf_bl(
        bl_no="BL-CONFLICT-001",
        container="MSKU2222222",
        invoice_no="INV-A-100",
    )
    res_c = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Conflicting document arrival"},
        files=[("files", ("conflicting.pdf", bill_conflicting, "application/pdf"))],
    )
    assert res_c.status_code == 201
    case_c_id = res_c.json()["case_id"]
    finish_queue()

    case_c = staff.get(f"{API}/intakes/{case_c_id}").json()
    assert case_c["state"] == "manual_matching"

    res_link = staff.post(
        f"{API}/intakes/{case_c_id}/match-shipment",
        json={"target_case_id": case_a_id},
    )
    assert res_link.status_code == 200
    finish_queue()

    case_a = staff.get(f"{API}/intakes/{case_a_id}").json()
    assert any(d["original_filename"] == "conflicting.pdf" for d in case_a["documents"])


def test_incomplete_document_awaiting_update(staff):
    sheet = make_invoice_xlsx(invoice_no="INV-INCOMPLETE-001", container="INCU5000005")
    res = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Incomplete shipment INV-INCOMPLETE-001"},
        files=[("files", ("invoice.xlsx", sheet, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))],
    )
    assert res.status_code == 201
    case_id = res.json()["case_id"]
    finish_queue()

    case = staff.get(f"{API}/intakes/{case_id}").json()
    assert case["state"] == "awaiting_updated_document"

    bill = make_pdf_bl(bl_no="BL-COMPLETE-001", invoice_no="INV-INCOMPLETE-001", container="INCU5000005")
    res2 = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "B/L for INV-INCOMPLETE-001"},
        files=[("files", ("bill.pdf", bill, "application/pdf"))],
    )
    assert res2.status_code in (200, 201)
    finish_queue()

    case_updated = staff.get(f"{API}/intakes/{case_id}").json()
    assert case_updated["state"] in ("needs_review", "ready_for_approval")


def test_final_bl_confirmation_workflow(staff):
    res = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Shipment INV-FIXTURE-101"},
        files=[
            ("files", ("supplier.xlsx", supplier(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
            ("files", ("draft.pdf", draft_bill(), "application/pdf")),
        ],
    )
    assert res.status_code == 201
    case_id = res.json()["case_id"]
    finish_queue()

    analysis = staff.get(f"{API}/intakes/{case_id}/analysis").json()
    rev = analysis["analysis_revision"]

    review_res = staff.post(
        f"{API}/intakes/{case_id}/review",
        json={
            "expected_revision": rev,
            "expected_review_id": None,
            "corrections": [],
            "resolutions": [],
            "mappings": [],
            "verify_cdc_mappings": False,
        },
    )
    assert review_res.status_code == 200

    approve_res = staff.post(
        f"{API}/intakes/{case_id}/approve",
        json={"expected_revision": rev, "review_id": review_res.json()["id"], "notes": "Initial draft approval"},
    )
    assert approve_res.status_code == 200

    case_approved = staff.get(f"{API}/intakes/{case_id}").json()
    assert case_approved["state"] == "approved"

    bill_telex = make_pdf_bl(
        bl_no="DEMOBL0001",
        is_telex=True,
        container="ABCD1234567",
        seal="SITA888888",
        vessel="SITC NINGBO V. 2620S",
        invoice_no="INV-FIXTURE-101",
    )
    res_telex = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Telex Release for DEMOBL0001"},
        files=[("files", ("telex_final.pdf", bill_telex, "application/pdf"))],
    )
    assert res_telex.status_code in (200, 201)
    finish_queue()

    case_after_telex = staff.get(f"{API}/intakes/{case_id}").json()
    assert case_after_telex["state"] == "needs_review"
    assert "Final B/L" in (case_after_telex["review_reason"] or "")

    confirm_res = staff.post(f"{API}/intakes/{case_id}/confirm-final-bl")
    assert confirm_res.status_code == 200
    assert confirm_res.json()["status"] == "confirmed"

    case_confirmed = staff.get(f"{API}/intakes/{case_id}").json()
    assert case_confirmed["state"] == "approved"


def test_stale_approval_rejection_409(staff):
    sheet = make_invoice_xlsx(invoice_no="INV-STALE-001", container="STLU1234567")
    bill_v1 = make_pdf_bl(bl_no="BL-STALE-001", invoice_no="INV-STALE-001", container="STLU1234567", weight="100.00")

    res = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Arrival INV-STALE-001"},
        files=[
            ("files", ("invoice.xlsx", sheet, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
            ("files", ("bill_v1.pdf", bill_v1, "application/pdf")),
        ],
    )
    assert res.status_code == 201
    case_id = res.json()["case_id"]
    finish_queue()

    review_res = staff.post(
        f"{API}/intakes/{case_id}/review",
        json={
            "expected_revision": 1,
            "expected_review_id": None,
            "corrections": [],
            "resolutions": [],
            "mappings": [],
            "verify_cdc_mappings": False,
        },
    )
    assert review_res.status_code == 200
    review_id = review_res.json()["id"]

    bill_v2 = make_pdf_bl(bl_no="BL-STALE-001", invoice_no="INV-STALE-001", container="STLU1234567", weight="150.00")
    res_v2 = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Revised BL-STALE-001"},
        files=[("files", ("bill_v2.pdf", bill_v2, "application/pdf"))],
    )
    assert res_v2.status_code in (200, 201)
    finish_queue()

    stale_attempt = staff.post(
        f"{API}/intakes/{case_id}/approve",
        json={"expected_revision": 1, "review_id": review_id, "notes": "Trying to approve old revision"},
    )
    assert stale_attempt.status_code == 409
    assert "revision" in stale_attempt.text.casefold() or "superseded" in stale_attempt.text.casefold()


@pytest.mark.skipif(not REAL_SAMPLE_DIR.exists(), reason="Real sample directory not available on this host")
def test_real_sample_9_ct2611010_workflow(staff, monkeypatch):
    from shipping_ai.core.config import settings
    monkeypatch.setattr(settings(), "max_file_bytes", 10 * 1024 * 1024)
    excel_file = REAL_SAMPLE_DIR / "CT2611010 3件 报关资料(1).xlsx"
    draft_file = REAL_SAMPLE_DIR / "HBL COPY_SIH26110051(1).pdf"
    telex_file = REAL_SAMPLE_DIR / "TELEX-HHSE6111171(1).pdf"

    assert excel_file.exists()
    assert draft_file.exists()
    assert telex_file.exists()

    excel_bytes = excel_file.read_bytes()
    draft_bytes = draft_file.read_bytes()
    telex_bytes = telex_file.read_bytes()

    res1 = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Import CT2611010 documents"},
        files=[
            ("files", (excel_file.name, excel_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
            ("files", (draft_file.name, draft_bytes, "application/pdf")),
        ],
    )
    assert res1.status_code == 201
    case_id = res1.json()["case_id"]
    finish_queue()

    case1 = staff.get(f"{API}/intakes/{case_id}").json()
    assert len(case1["documents"]) == 2
    assert case1["detected_reference"] == "CT2611010"

    res2 = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": "Telex Release for CT2611010 HHSE6111171"},
        files=[("files", (telex_file.name, telex_bytes, "application/pdf"))],
    )
    assert res2.status_code in (200, 201)
    finish_queue()

    case2 = staff.get(f"{API}/intakes/{case_id}").json()
    assert len(case2["documents"]) == 3
    final_bl_doc = next(d for d in case2["documents"] if d["original_filename"] == telex_file.name)
    assert final_bl_doc["classification"] == "final_bl"

    analysis = staff.get(f"{API}/intakes/{case_id}/analysis").json()
    final_ext = next((e for e in analysis["extractions"] if e["document_id"] == final_bl_doc["id"]), None)
    assert final_ext is not None
    assert final_ext["fields"]["container"]["value"] == "ONEU4862890"
    assert final_ext["fields"]["seal"]["value"] == "SITA210019"

    v_diff = analysis.get("version_diff")
    assert v_diff is not None
    assert v_diff["is_final_bl"] is True
    assert v_diff["requires_final_confirmation"] is True
