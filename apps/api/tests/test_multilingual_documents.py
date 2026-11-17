from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from multilingual_examples import LANGUAGES, TEXT, document, expected, observed

from shipping_ai.ai.provider import ProviderUnavailable
from shipping_ai.ai.translation import choices, overlay, propose
from shipping_ai.approvals.review import Correction, apply_corrections, blockers_for
from shipping_ai.documents.extract import extract
from shipping_ai.documents.languages import languages
from shipping_ai.documents.text_representation import apply_company_aliases
from shipping_ai.review.values import decimal

NUMBER_FIELDS = {"quantity", "unit_price", "amount"}


def aligned(value, target, key):
    return decimal(value) == decimal(target) if key in NUMBER_FIELDS else value == target


@pytest.mark.parametrize("suffix", ["pdf", "xls", "xlsx"])
@pytest.mark.parametrize("language", list(TEXT))
def test_fictional_invoice_fields_and_evidence(language, suffix):
    document_id = uuid4()
    [doc] = extract(document(language, suffix), f"fictional.{suffix}", document_id, "other")
    actual, fields = observed(doc)
    assert doc.status == "extracted"
    for key, target in expected(language).items():
        assert aligned(actual[key], target, key), key
    assert doc.source_languages == LANGUAGES[language]
    assert doc.record_language == "en"
    assert fields["description"].original_text == TEXT[language][16]
    assert fields["description"].english.status == ("source" if language == "en" else "pending")
    assert fields["supplier"].english is None
    assert fields["invoice_no"].value == "FABLE-482"
    assert fields["quantity"].unit == "PCS"
    for key in (
        "invoice_no",
        "supplier",
        "consignee",
        "origin",
        "destination",
        "description",
        "quantity",
        "unit",
        "unit_price",
        "amount",
    ):
        assert fields[key].evidence[0].document_id == document_id, key
    if suffix == "pdf":
        desc = fields["description"].evidence[0]
        assert desc.page == 1 and 0.04 < desc.bbox[0] < 0.06 and 0.55 < desc.bbox[1] < 0.65
        assert desc.raw == TEXT[language][16]
        assert fields["quantity"].evidence[1].bbox[0] > fields["quantity"].evidence[0].bbox[0]
    else:
        assert fields["invoice_no"].evidence[0].cell == "B2"
        assert fields["consignee"].evidence[0].cell == "B4"
        assert fields["description"].evidence[0].cell == "A8"
        assert [e.cell for e in fields["quantity"].evidence] == ["B8", "C8"]
        assert fields["quantity"].evidence[0].raw == (
            "៦" if language == "km" else ("6.0" if suffix == "xls" else "6")
        )


@pytest.mark.parametrize("language", list(TEXT))
def test_raster_invoice_uses_language_profile_and_never_approves_ocr(language):
    from shutil import which
    from subprocess import check_output

    if not which("tesseract"):
        pytest.skip("Tesseract is required for raster verification")
    packs = check_output(["tesseract", "--list-langs"], text=True).splitlines()[1:]
    if not {"eng", "khm", "chi_sim", "chi_tra"} <= set(packs):
        pytest.skip("The API Docker image includes all four OCR language packs")
    [doc] = extract(document(language, "scan"), "fictional.pdf", uuid4(), "other")
    assert doc.role == "invoice"
    assert doc.method == "tesseract"
    assert doc.fields["invoice_no"].value == "FABLE-482"
    assert doc.fields["invoice_no"].status == "uncertain"
    if language != "en":
        assert any("khm" in a["language"] and "chi_tra" in a["language"] for a in doc.recovery)
    assert len(doc.items) == 1
    assert decimal(doc.items[0].fields["amount"].value) == 75
    assert doc.items[0].fields["description"].status == "uncertain"
    assert doc.items[0].fields["quantity"].status != "present"


class Provider:
    config = SimpleNamespace(ollama_model="qwen3.5:4b-q4_K_M")

    def __init__(self, wording, *, key=None, status="translated"):
        self.wording, self.key, self.status = wording, key, status

    def translate(self, entries, schema):
        assert all(item["field"] in {"description", "origin", "destination"} for item in entries)
        key = self.key or next(item["key"] for item in entries if item["field"] == "description")
        return schema.model_validate(
            {
                "translations": [{"key": key, "status": self.status, "english": self.wording}],
            }
        ), "a" * 64


@pytest.mark.parametrize(
    ("response", "status"),
    [
        ("Ceramic bearings BX-24", "proposed"),
        ("Ceramic bearings BX-99", "ambiguous"),
        ("Ceramic bearings", "ambiguous"),
        ("Bearing 陶瓷 BX-24", "ambiguous"),
    ],
)
def test_translation_preserves_description_codes_and_never_replaces_source(response, status):
    [doc] = extract(document("zh", "xlsx"), "fixture.xlsx", uuid4(), "other")
    request = choices([doc])
    description = doc.items[0].fields["description"]
    saved = propose(Provider(response), request)
    overlay([doc], saved, ai_state="ready")
    assert description.english.status == status
    assert description.english.value == (response if status == "proposed" else None)
    assert description.english.evidence == description.evidence
    assert description.english.model_digest == "a" * 64
    assert description.value == TEXT["zh"][16]
    assert doc.items[0].fields["quantity"].value == "6"
    assert any(
        "verified English goods description" in blocker for blocker in blockers_for([doc], {})[0]
    )


def test_unknown_model_key_and_outage_leave_deterministic_data_intact():
    [doc] = extract(document("mixed", "xls"), "fictional.xls", uuid4(), "other")
    requests = choices([doc])
    assert propose(Provider("text", key="f" * 32), requests)["state"] == "invalid_output"

    class Unavailable:
        def translate(self, *args):
            raise ProviderUnavailable()

    snapshot = propose(Unavailable(), requests)
    assert snapshot["state"] == "unavailable"
    actual, _ = observed(doc)
    overlay([doc], snapshot, ai_state="unavailable")
    assert observed(doc)[0] == actual
    assert doc.items[0].fields["description"].english.status == "unavailable"


def test_only_unique_admin_alias_and_staff_confirmed_english_are_used():
    [doc] = extract(document("km", "xlsx"), "fictional.xlsx", uuid4(), "other")
    party, description = doc.fields["consignee"], doc.items[0].fields["description"]
    original = party.value
    company = SimpleNamespace(
        id=uuid4(), name=original, aliases=[], verified_english_name="Moon Import"
    )
    apply_company_aliases([doc], [company])
    assert party.value == original
    assert party.english.value == "Moon Import"
    assert party.english.company_id == company.id
    assert party.english.evidence == party.evidence
    other = SimpleNamespace(
        id=uuid4(), name="Other", aliases=[original], verified_english_name=None
    )
    apply_company_aliases([doc], [company, other])
    assert party.english.status == "ambiguous"
    assert party.english.value is None
    correction = Correction(
        document_id=doc.document_id,
        role=doc.role,
        row=doc.items[0].row,
        name="english_description",
        value="Cotton gloves BX-24",
        note="Compared with original",
    )
    with pytest.raises(HTTPException, match="preserving"):
        apply_corrections([doc], [correction.model_copy(update={"value": "Gloves BX-42"})])
    apply_corrections([doc], [correction])
    assert description.original_text == TEXT["km"][16]
    assert description.english.status == "staff_verified"
    assert description.english.evidence == description.evidence
    assert not any("verified English goods description" in b for b in blockers_for([doc], {})[0])


def test_script_detection_skips_identifiers_and_flags_unrecognized_scripts():
    assert languages("FABLE-482 USD ៦") == []
    assert languages("Bearing 轴承 ស្រោមដៃ") == ["en", "km", "zh"]
    assert languages("เกลียว") == ["und"]


@pytest.mark.parametrize("with_master", [False, True])
def test_worker_proposal_is_audited_then_staff_approves_separate_english(
    staff, monkeypatch, with_master
):
    from datetime import UTC, datetime
    from io import BytesIO

    from fixtures.build_samples import master
    from openpyxl import Workbook, load_workbook
    from test_phase_two import finish_queue

    from shipping_ai.ai.provider import OllamaProvider
    from shipping_ai.core.config import settings

    finish_queue()
    monkeypatch.setattr(settings(), "ollama_enabled", True)
    monkeypatch.setattr(settings(), "investigation_enabled", False)
    model = Provider("Ceramic bearings BX-24")
    cdc_label = "Ceramic bearings BX-24, industrial"
    monkeypatch.setattr(
        OllamaProvider, "translate", lambda self, entries, schema: model.translate(entries, schema)
    )
    monkeypatch.setattr(OllamaProvider, "advise", lambda *_: SimpleNamespace(suggestions=[]))

    api = "/api/v1"
    directory = staff.post(
        f"{api}/companies",
        json={
            "name": TEXT["zh"][13],
            "verified_english_name": "White Sail Import",
        },
    )
    if directory.status_code == 409:
        companies = staff.get(f"{api}/companies", params={"q": TEXT["zh"][13]}).json()
        company_id = next(entry["id"] for entry in companies if entry["name"] == TEXT["zh"][13])
    else:
        assert directory.status_code == 201
        company_id = directory.json()["id"]
    master_id = None
    if with_master:
        cdc = load_workbook(BytesIO(master(company=TEXT["zh"][13], price="12.5")))
        cdc.active["B3"] = cdc_label
        source = BytesIO()
        cdc.save(source)
        cdc.close()
        response = staff.post(
            f"{api}/cdc/versions",
            data={
                "company": TEXT["zh"][13],
                "company_id": company_id,
                "year": "2026",
                "approval_ref": "DEMO-2026",
                "verified": "true",
                "balance_as_of": datetime.now(UTC).date().isoformat(),
            },
            files={
                "file": (
                    "master.xlsx",
                    source.getvalue(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        assert response.status_code == 201, response.text
        master_id = response.json()["id"]
    book = Workbook()
    sheet = book.active
    sheet.append(["裝箱單"])
    sheet.append(["發票號碼", "FABLE-482"])
    sheet.append(["收貨人", TEXT["zh"][13]])
    sheet.append(["品名", "數量", "單位"])
    sheet.append([TEXT["zh"][16], 6, "件"])
    out = BytesIO()
    book.save(out)
    mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    response = staff.post(
        f"{api}/intakes/simulate",
        files=[
            ("files", ("fictional-invoice.xlsx", document("zh", "xlsx"), mimetype)),
            ("files", ("fictional-packing.xlsx", out.getvalue(), mimetype)),
        ],
        data={"provider_message_id": uuid4().hex},
    )
    assert response.status_code == 201
    case = f"{api}/intakes/{response.json()['case_id']}"
    finish_queue()
    view = staff.get(f"{case}/analysis").json()
    if master_id:
        assert (
            staff.post(
                f"{case}/cdc-version",
                json={
                    "version_id": master_id,
                    "expected_revision": view["revision"],
                },
            ).status_code
            == 202
        )
        finish_queue()
        view = staff.get(f"{case}/analysis").json()
        assert [entry["description"] for entry in view["candidates"]] == [cdc_label]
        assert any(issue["key"].endswith(".unmatched") for issue in view["findings"])
    assert view["ai_state"] == "ready"
    invoice = next(d for d in view["extractions"] if d["role"] == "invoice")
    item = invoice["items"][0]
    description = item["fields"]["description"]
    assert description["english"]["status"] == "proposed"
    assert description["english"]["evidence"][0]["cell"] == "A8"
    assert invoice["fields"]["consignee"]["english"]["value"] == "White Sail Import"
    request = {
        "expected_revision": view["revision"],
        "expected_review_id": None,
        "notes": "Source reviewed.",
    }
    assert staff.post(f"{case}/review-and-approve", json=request).status_code == 409
    request["corrections"] = [
        {
            "document_id": invoice["document_id"],
            "role": "invoice",
            "row": item["row"],
            "name": "english_description",
            "value": "Ceramic bearings BX-24",
            "note": "Verified against A8.",
        }
    ]
    if not master_id:
        issue = next(
            issue
            for issue in staff.get(f"{case}/review").json()["issues"]
            if issue["target"]
            and issue["target"]["role"] == "invoice"
            and issue["target"]["name"] == "english_description"
            and issue["suggestion"]
        )
        assert issue["suggestion"]["evidence"] == description["english"]["evidence"]
        review_request = {
            key: value for key, value in request.items() if key not in {"notes", "corrections"}
        }
        pending = staff.post(f"{case}/review", json=review_request).json()
        assert not pending["ready"] and pending["open_issues"][issue["key"]]
        review_request.update(
            expected_review_id=pending["id"],
            issue_actions=[{"key": issue["key"], "action": "accept_ai"}],
        )
        reviewed = staff.post(f"{case}/review", json=review_request)
        assert reviewed.status_code == 200, reviewed.text
        saved = reviewed.json()
        assert saved["ready"] and issue["key"] not in saved["open_issues"]
        assert saved["issue_log"][0]["suggestion"] == issue["suggestion"]
        assert saved["changes"][0]["after"]["evidence"] == issue["suggestion"]["evidence"]
        assert staff.get(f"{case}/analysis").json()["extractions"] == view["extractions"]
        approval = staff.post(
            f"{case}/approve",
            json={
                "expected_revision": view["revision"],
                "review_id": saved["id"],
                "notes": request["notes"],
            },
        )
    else:
        request["mappings"] = [
            {"invoice_row": item["row"], "master_row": view["candidates"][0]["master_row"]}
        ]
        assert staff.post(f"{case}/review-and-approve", json=request).status_code == 422
        request["verify_cdc_mappings"] = True
        approval = staff.post(f"{case}/review-and-approve", json=request)
    assert approval.status_code == 200, approval.text
    approved = staff.get(f"{api}/imports/{approval.json()['import_id']}").json()
    assert approved["consignee"] == TEXT["zh"][13]
    assert approved["items"][0]["raw_description"] == TEXT["zh"][16]
    assert approved["items"][0]["normalized_description"] == (
        cdc_label if with_master else "Ceramic bearings BX-24"
    )
    if with_master:
        review = staff.get(f"{case}/review").json()["review"]
        assert review["cdc_names"][0]["description"] == cdc_label
        assert review["cdc_names"][0]["evidence"][0]["cell"] == "B3"
        drafts = staff.get(f"{api}/imports/{approval.json()['import_id']}/permit-drafts").json()
        assert len(drafts) == 1
        permit = staff.get(
            f"{api}/imports/{approval.json()['import_id']}/permit-drafts/{drafts[0]['id']}/download"
        )
        workbook = load_workbook(BytesIO(permit.content))
        assert workbook["INV"]["B12"].value == cdc_label.upper()
        workbook.close()
    assert approved["items"][0]["quantity"] == "6.000000"


def test_khmer_spelling_keeps_combining_marks_during_deterministic_comparison():
    from shipping_ai.review.compare import compare
    from shipping_ai.review.values import field, source_identity

    assert source_identity("ភ្នំ") != source_identity("ភ្នា")
    check = compare("invoice_packing", "consignee", field("ភ្នំ"), field("ភ្នា"))
    assert check.outcome == "MISMATCH"


def test_ocr_heading_tolerance_keeps_units_out_of_price_columns():
    from shipping_ai.documents.languages import column_map

    headers = ["ការពិពណ៍នាទំនិញ", "數量", "单位价格 Unit Price", "金額"]
    assert column_map(headers, ocr=True) == {
        "description": 0,
        "quantity": 1,
        "unit_price": 2,
        "amount": 3,
    }
    assert "description" not in column_map(headers)


def test_descriptions_with_printed_legal_names_require_manual_translation():
    from shipping_ai.documents.text_representation import annotate_languages

    [doc] = extract(document("zh", "xlsx"), "fictional.xlsx", uuid4(), "other")
    original = doc.items[0].fields["description"]
    original.value = f"{doc.fields['supplier'].value} {original.value}"
    annotate_languages(doc)
    assert original.english.status == "ambiguous"
    assert not any(entry["field"] == "description" for entry in choices([doc]).values())


@pytest.mark.parametrize("repeated_origin_label", [None, "Port of loading:"])
def test_printed_port_continuation_controls_english_and_transport_evidence(repeated_origin_label):
    from io import BytesIO

    from openpyxl import Workbook

    from shipping_ai.review.compare import transport
    from shipping_ai.review.schemas import Evidence, Extraction
    from shipping_ai.review.values import field

    workbook = Workbook()
    invoice = workbook.active
    invoice.title = "INV"
    for cells in [
        ["Commercial Invoice"],
        ["Invoice No.", "EX-104"],
        ["起运港：", None, "厦门"],
        [repeated_origin_label, None, "XIAMEN"],
        ["目的港：", None, "泰国"],
        [None, None, "Laem Chabang"],
        ["Description", "Quantity", "Unit"],
        ["Industrial bearings", 7, "PCS"],
    ]:
        invoice.append(cells)
    output = BytesIO()
    workbook.save(output)
    document_id = uuid4()
    [result] = extract(output.getvalue(), "fictional.xlsx", document_id, "other")

    origin = result.fields["origin"]
    assert origin.value == "厦门"
    assert origin.evidence[0].cell == "C3"
    assert origin.english.value == "XIAMEN"
    assert origin.english.status == "source" and origin.english.evidence[0].cell == "C4"

    destination = result.fields["destination"]
    assert destination.value == "泰国"
    assert destination.original_text == "泰国"
    assert destination.evidence[0].cell == "C5"
    assert destination.english.value == "Laem Chabang"
    assert destination.english.status == "source" and destination.english.evidence[0].cell == "C6"
    assert not any(
        request["field"] in {"origin", "destination"} for request in choices([result]).values()
    )

    bl_id = uuid4()
    bill = Extraction(
        document_id=bl_id,
        role="draft_bl",
        status="extracted",
        method="pdf_text",
        document_kind="bill_of_lading",
        fields={
            "origin": field("Xiamen", Evidence(document_id=bl_id, page=1)),
            "delivery": field("LAEM CHABANG", Evidence(document_id=bl_id, page=1)),
        },
    )
    findings = transport(result, None, bill)
    assert [(check.field, check.outcome, check.evidence[0].cell) for check in findings] == [
        ("origin", "PASS", "C4"),
        ("destination", "PASS", "C6"),
    ]


@pytest.mark.parametrize("next_row", [["Vessel:", None, "Ocean Star"], [None, None, None]])
def test_printed_route_requires_immediate_continuation_in_same_field(next_row):
    from shipping_ai.documents.extract import metadata

    rows = [
        (1, ["起运港：", None, "厦门"]),
        (2, next_row),
        (3, [None, None, "Ocean Star"]),
    ]
    origin = metadata(uuid4(), "Ports", rows, {}, "invoice")["origin"]
    assert origin.value == "厦门"
    assert origin.english is None
