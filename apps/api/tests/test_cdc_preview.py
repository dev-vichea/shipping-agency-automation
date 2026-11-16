from http import HTTPStatus
from io import BytesIO

import pymupdf
from fixtures.build_samples import COMPANY, XLSX, master
from openpyxl import load_workbook

API = "/api/v1"
PREVIEW = f"{API}/cdc/versions/preview"


def test_workbook_preview_suggests_scoped_company_and_headers_without_registering(staff):
    assert (
        staff.post(f"{API}/workspaces", json={"name": "Workbook Preview Tests"}).status_code == 201
    )
    company = staff.post(f"{API}/companies", json={"name": "Test division", "aliases": [COMPANY]})
    assert company.status_code == HTTPStatus.CREATED
    before = staff.get(f"{API}/cdc/versions?limit=100").json()
    response = staff.post(PREVIEW, files={"file": ("master.xlsx", master(), XLSX)})
    assert response.status_code == HTTPStatus.OK, response.text
    result = response.json()
    assert result["company_id"] == company.json()["id"]
    assert result["item_count"] == 1
    assert result["fields"]["company"]["value"] == COMPANY
    assert result["fields"]["company"]["evidence"]["location"] == "CDC cut stock!A1"
    assert result["fields"]["approval_ref"]["value"] == "QIP # DEMO-2026"
    assert result["fields"]["year"]["value"] == "2026"
    assert "balance_as_of" not in result["fields"]
    assert staff.get(f"{API}/cdc/versions?limit=100").json() == before
    assert (
        staff.post(
            PREVIEW,
            files={"file": ("master.xlsx", master(), XLSX)},
            headers={"Origin": "https://invalid.example"},
        ).status_code
        == 403
    )
    assert (
        staff.post(
            f"{API}/cdc/versions",
            files={"file": ("master.xlsx", master(), XLSX)},
            data={
                "company": COMPANY,
                "year": 2026,
                "approval_ref": "DEMO-2026",
                "verified": "false",
            },
        ).status_code
        == 422
    )


def test_preview_reads_labelled_stock_date_and_suppresses_conflicts(staff):
    workbook = load_workbook(BytesIO(master()))
    workbook.active["C1"] = "Balance as of"
    workbook.active["D1"] = "2026-01-25"
    workbook.active["E1"] = "Approval year: 2025"
    content = BytesIO()
    workbook.save(content)
    workbook.close()
    result = staff.post(PREVIEW, files={"file": ("master.xlsx", content.getvalue(), XLSX)}).json()
    assert "year" not in result["fields"]
    assert any("Several values were found for year" in warning for warning in result["warnings"])
    date = result["fields"]["balance_as_of"]
    assert date["value"] == "2026-01-25"
    assert date["evidence"]["location"] == "CDC cut stock!C1:D1"


def test_scanned_approval_uses_ocr_and_reports_the_page(staff, monkeypatch):
    from shipping_ai.core.config import settings

    monkeypatch.setattr(settings(), "max_file_bytes", 256 * 1024)
    with pymupdf.open() as embedded:
        page = embedded.new_page(width=480, height=220)
        page.insert_text((30, 75), "Balance as of: 2026-01-25", fontsize=20)
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), colorspace=pymupdf.csGRAY)
        with pymupdf.open() as scan:
            scan_page = scan.new_page(width=480, height=220)
            scan_page.insert_image(scan_page.rect, stream=pixmap.tobytes("png"))
            assert not scan_page.get_text().strip()
            raster = scan.tobytes(deflate=True)

    response = staff.post(
        PREVIEW,
        files={
            "file": ("master.xlsx", master(), XLSX),
            "approval_pdf": ("approval.pdf", raster, "application/pdf"),
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    date = result["fields"]["balance_as_of"]
    assert date["value"] == "2026-01-25"
    assert date["evidence"]["source"] == "ocr"
    assert date["evidence"]["location"] == "approval.pdf, page 1"


def test_model_suggestions_require_verbatim_evidence(staff, monkeypatch):
    import httpx

    from shipping_ai.cdc import preview
    from shipping_ai.core.config import settings

    monkeypatch.setattr(settings(), "ollama_enabled", True)

    def model(*args, **kwargs):
        return httpx.Response(
            200,
            request=httpx.Request("POST", "http://localhost"),
            json={
                "done": True,
                "done_reason": "stop",
                "response": preview.ModelChoices(
                    suggestions=[
                        {"field": "company", "line": 1, "value": "Harbor Widgets"},
                        {"field": "approval_ref", "line": 1, "value": "QIP99999"},
                        {"field": "balance_as_of", "line": 2, "value": "2026-01-11"},
                    ]
                ).model_dump_json(),
            },
        )

    monkeypatch.setattr(preview.httpx, "post", model)
    lines = [
        preview.EvidenceLine(
            source="workbook", location="Cover!A1", text="Enterprise on record: Harbor Widgets"
        ),
        preview.EvidenceLine(
            source="workbook", location="Cover!A2", text="Approval signed: 2026-01-11"
        ),
    ]
    result, state = preview.suggest_with_model(lines, {"company", "approval_ref", "balance_as_of"})
    assert state == "reviewed"
    assert list(result) == ["company"]
    assert result["company"].evidence.location == "Cover!A1"
    assert result["company"].method == "ai"


def test_cib_application_distinguishes_form_code_from_letter_reference(staff):
    book = load_workbook(BytesIO(master()))
    sheet = book.active
    sheet["A1"] = "CIB 01E(i)"
    sheet["B1"] = None
    sheet["D1"] = f"Company : {COMPANY} (ក្រុមហ៊ុនសាកល្បង)"
    sheet["M1"] = f"{COMPANY} (ក្រុមហ៊ុនសាកល្បង)"
    sheet["D2"] = "CIB file No.123/26 (03 September 2026)"
    content = BytesIO()
    book.save(content)
    book.close()
    files = {"file": ("application.xlsx", content.getvalue(), XLSX)}

    result = staff.post(PREVIEW, files=files)
    assert result.status_code == 200, result.text
    fields = result.json()["fields"]
    assert fields["company"]["value"] == COMPANY
    assert fields["company"]["evidence"]["location"] == "CDC cut stock!D1"
    assert fields["approval_ref"]["value"] == "CIB file No.123/26"
    assert fields["approval_ref"]["evidence"]["location"] == "CDC cut stock!D2"
    assert fields["year"]["value"] == "2026"
    assert "balance_as_of" not in fields
    assert result.json()["warnings"] == []

    metadata = {"company": COMPANY, "year": 2026, "verified": "true"}
    wrong = staff.post(
        f"{API}/cdc/versions", files=files, data={**metadata, "approval_ref": "CIB 01E"}
    )
    assert wrong.status_code == 422
    assert "approval reference differs" in wrong.json()["detail"]


def test_khmer_approval_header_dates_the_letter_without_using_validity_period():
    from shipping_ai.cdc.preview import preview

    book = load_workbook(BytesIO(master()))
    sheet = book.active
    sheet["A1"] = f"ក្រុមហ៊ុនៈ {COMPANY}"
    sheet["B1"] = None
    sheet["G1"] = "តាមរយៈលិខិតលេខ QIP123/26 ចុះថ្ងៃទី03 ខែកញ្ញា ឆ្នាំ2026"
    sheet["M1"] = "ជាតិ សាសនា ព្រះមហាក្សត្រ"
    sheet["K2"] = "ចាប់ពីឆ្នាំ 2026 ដល់ឆ្នាំ 2027"
    content = BytesIO()
    book.save(content)
    book.close()

    result = preview(content.getvalue(), "cut-stock.xlsx")
    assert result.fields["company"].value == COMPANY
    assert result.fields["company"].evidence.location == "CDC cut stock!A1"
    assert result.fields["approval_ref"].value == "QIP123/26"
    assert result.fields["year"].value == "2026"
    assert result.fields["year"].evidence.location == "CDC cut stock!G1"
    assert "balance_as_of" not in result.fields
    assert result.warnings == []
