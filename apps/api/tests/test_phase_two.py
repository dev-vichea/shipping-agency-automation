from datetime import UTC, datetime
from decimal import Decimal
from functools import lru_cache
from types import SimpleNamespace
from uuid import UUID, uuid4

import httpx
import pymupdf
import pytest
from fastapi.testclient import TestClient
from fixtures.build_samples import COMPANY, REFERENCE, XLSX, draft_bill, master, supplier
from sqlalchemy import func, select

from shipping_ai.ai.provider import InvalidAdvisory, OllamaProvider, review_context
from shipping_ai.cdc.master import check_cdc, company_key, parse_master
from shipping_ai.core.config import Settings
from shipping_ai.documents.extract import extract
from shipping_ai.review.compare import line_comparisons, overall, review_documents

API = "/api/v1"


def documents(data=None, bill=None):
    return [
        *extract(data if data is not None else supplier(), "supplier.xlsx", uuid4(), "other"),
        *extract(bill if bill is not None else draft_bill(), "draft.pdf", uuid4(), "other"),
    ]


def test_extract_and_compare_sanitized_supplier_and_bill():
    extracted = documents()
    findings, roles = review_documents(extracted)
    assert overall(findings) == "PASS"
    invoice, packing, bill = (roles[key] for key in ("invoice", "packing_list", "draft_bl"))
    assert invoice.fields["invoice_no"].value == REFERENCE
    assert invoice.fields["invoice_no"].evidence[0].cell == "B3"
    assert packing.items[0].fields["gross_weight"].unit == "KG"
    assert invoice.items[0].fields["amount"].value == "30.00"
    assert invoice.items[0].fields["amount"].currency == "USD"
    assert bill.fields["gross_weight"].evidence[0].page == 1
    assert bill.fields["container"].value == "ABCD1234567"
    assert bill.fields["etd"].status == bill.fields["eta"].status == "missing"
    assert all(
        f.field not in {"amount", "unit_price", "etd", "eta"}
        for f in findings
        if f.group == "transport"
    )


def test_merged_layout_and_missing_formula_value():
    invoice = extract(supplier(merged=True), "merged.xlsx", uuid4(), "invoice")[0]
    assert invoice.status == "extracted"
    assert invoice.items[0].fields["quantity"].evidence[0].cell == "E25"
    assert invoice.items[0].fields["unit_price"].evidence[0].cell == "H25"
    assert Decimal(invoice.items[0].fields["amount"].value) == Decimal("30")
    findings, roles = review_documents(
        documents(supplier(missing_ref=True, missing_amount=True), draft_bill(unreadable=True))
    )
    assert roles["invoice"].fields["invoice_no"].value is None
    assert roles["invoice"].items[0].fields["amount"].status == "missing"
    assert roles["draft_bl"].status == "failed"
    assert any(f.field == "invoice_no" and f.outcome == "NEEDS_REVIEW" for f in findings)


def test_invoice_currency_in_footer_is_linked_to_the_printed_total_and_lines():
    invoice = documents(supplier(merged=True, footer_currency="USD", declared_subtotal="54.75"))[0]
    for item in invoice.items:
        for key in ("unit_price", "amount"):
            value = item.fields[key]
            assert value.currency == "USD"
            assert value.evidence[-1].cell == "J36"
    assert invoice.fields["amount"].currency == "USD"
    assert [e.cell for e in invoice.fields["amount"].evidence] == ["J35", "J36"]


def test_footer_currency_does_not_override_explicit_column_currency():
    invoice = documents(supplier(footer_currency="CNY"))[0]
    assert invoice.items[0].fields["amount"].currency == "USD"
    assert [e.cell for e in invoice.fields["amount"].evidence] == ["G11"]


def test_mismatches_are_deterministic():
    findings, _ = review_documents(
        documents(supplier(packing_quantity=10, packing_price="2.75"), draft_bill(weight="26.00"))
    )
    found = {(item.group, item.field) for item in findings if item.outcome == "MISMATCH"}
    assert {
        ("invoice_packing", "quantity"),
        ("invoice_packing", "unit_price"),
        ("transport", "gross_weight"),
    } <= found
    assert all(item.evidence for item in findings if item.outcome == "MISMATCH")


def test_audit_checks_declared_subtotal_and_container_check_digit():
    extracted = documents(
        supplier(packing_quantity=10, declared_subtotal="31.00"),
        draft_bill(container="CSQU 305438-3"),
    )
    findings, _ = review_documents(extracted)
    checks = {check.field: check for check in findings if check.group == "validation"}
    assert checks["invoice_subtotal"].outcome == "MISMATCH"
    assert checks["invoice_subtotal"].right == "30.00 USD"
    assert [e.cell for e in checks["invoice_subtotal"].evidence] == ["G11", "G10"]
    assert checks["currency_uniformity"].outcome == "PASS"
    assert checks["container_check_digit"].outcome == "PASS"
    assert line_comparisons(extracted, findings)[0].quantity_delta == "-2"
    changed, _ = review_documents(documents(bill=draft_bill(container="CSQU3054384")))
    container = next(check for check in changed if check.field == "container_check_digit")
    assert container.outcome == "MISMATCH" and container.right == "CSQU3054383"


def test_cdc_low_quota_warning_uses_a_current_workbook():
    invoice = documents()[0]
    today = datetime.now(UTC).date()
    parsed = parse_master(master(balance="20"), "master.xlsx", uuid4())
    version = SimpleNamespace(
        company=COMPANY,
        company_key=company_key(COMPANY),
        year=2026,
        approval_ref="DEMO-2026",
        balance_as_of=today,
        items=[item.model_dump(mode="json") for item in parsed.items],
    )
    checks, _ = check_cdc(invoice, version, today)
    assert any(check.field == "low_quota" and check.outcome == "WARNING" for check in checks)
    version.balance_as_of = None
    checks, _ = check_cdc(invoice, version, today)
    assert all(check.field != "low_quota" for check in checks)


@pytest.mark.parametrize("approved_price", [True, False])
def test_cdc_checks_units_prices_and_missing_balances(approved_price):
    invoice = documents()[0]
    parsed = parse_master(
        master(unit="ROLL", price="3", balance="=G3-5", price_header=approved_price),
        "master.xlsx",
        uuid4(),
    )
    version = SimpleNamespace(
        company=COMPANY,
        company_key=company_key(COMPANY),
        year=2026,
        approval_ref="DEMO-2026",
        balance_as_of=datetime.now(UTC).date(),
        items=[item.model_dump(mode="json") for item in parsed.items],
    )
    findings, candidates = check_cdc(invoice, version)
    assert candidates[0].score == 100
    assert any(f.field == "unit" and f.outcome == "MISMATCH" for f in findings)
    assert any(f.field == "unit_price" for f in findings) == approved_price
    assert not any(f.field == "approved_quantity" and f.outcome == "PASS" for f in findings)
    version.company_key = company_key("Other Ltd.")
    assert check_cdc(invoice, version)[1] == []

    parsed = parse_master(master(balance="=G3-5"), "master.xlsx", uuid4())
    version.company_key = company_key(COMPANY)
    version.items = [item.model_dump(mode="json") for item in parsed.items]
    findings, _ = check_cdc(invoice, version)
    assert any(f.field == "balance_unknown" and f.outcome == "NEEDS_REVIEW" for f in findings)
    parsed = parse_master(master(balance="10"), "master.xlsx", uuid4())
    version.items = [item.model_dump(mode="json") for item in parsed.items]
    assert any(
        f.field == "remaining_quantity" and f.outcome == "MISMATCH"
        for f in check_cdc(invoice, version)[0]
    )


@lru_cache
def replay_files():
    return supplier(packing_quantity=10), draft_bill(vessel="TEST VESSEL 47")


def send(staff, key, **metadata):
    return staff.post(
        f"{API}/intakes/simulate",
        data={"provider_message_id": key, **metadata},
        files=[
            ("files", ("supplier.xlsx", replay_files()[0], XLSX)),
            ("files", ("draft.pdf", replay_files()[1], "application/pdf")),
        ],
    )


def finish_queue():
    from datetime import UTC, datetime

    from shipping_ai.automation.tasks import drain
    from shipping_ai.core.db import session_factory
    from shipping_ai.models import AutomationRun

    for _ in range(50):
        with session_factory()() as db:
            due = db.scalar(
                select(AutomationRun.id)
                .where(
                    AutomationRun.state == "queued",
                    AutomationRun.available_at <= datetime.now(UTC),
                )
                .limit(1)
            )
        if due is None:
            return
        drain.run()
    pytest.fail("Test queue did not drain")


def test_pdf_preview_uses_cited_occurrence_for_repeated_text(staff):
    label = "Demo Port B"
    with pymupdf.open(stream=draft_bill(), filetype="pdf") as pdf:
        page = pdf[0]
        page.insert_text((72, 420), label)
        page.insert_text((72, 490), label)
        earlier, later = [
            index
            for index, text in enumerate(page.get_text().splitlines(), 1)
            if text.strip() == label
        ]
        data = pdf.tobytes()
    receipt = staff.post(
        f"{API}/intakes/simulate",
        data={"provider_message_id": uuid4().hex, "subject": "Repeated PDF destination"},
        files={"files": ("repeated.pdf", data, "application/pdf")},
    )
    assert receipt.status_code == 201, receipt.text
    case = staff.get(f"{API}/intakes/{receipt.json()['case_id']}").json()
    preview = f"{API}/documents/{case['documents'][0]['id']}/pages/1"
    first = staff.get(preview, params={"line": earlier}).json()["box"]
    second = staff.get(preview, params={"line": later}).json()["box"]
    assert first[1] < second[1]
    rotated = staff.get(preview, params={"line": later, "rotation": 90}).json()["box"]
    assert rotated[0] == pytest.approx(1 - second[1] - second[3])
    assert staff.get(preview, params={"line": later + 100}).json()["box"] is None


def test_persistent_review_replay_revision_and_master(staff):
    from shipping_ai.core.db import session_factory
    from shipping_ai.models import DocumentExtraction, ReviewSnapshot

    finish_queue()
    key = uuid4().hex
    metadata = {"subject": f"Fixture {key}", "sender": "supplier@example.test"}
    first = send(staff, key, **metadata)
    assert first.status_code == 201, first.text
    case_id = first.json()["case_id"]
    path = f"{API}/intakes/{case_id}"
    assert TestClient(staff.app).get(f"{path}/analysis").status_code == 401
    assert send(staff, key, **metadata).status_code == 200
    finish_queue()
    assert send(staff, key, **metadata).json()["replayed"] is True
    finish_queue()
    result = staff.get(f"{path}/analysis").json()
    assert result["state"] == "available" and result["outcome"] == "MISMATCH"
    assert len(result["extractions"]) == 3
    assert result["line_items"] == [
        {
            "invoice_row": 10,
            "packing_row": 11,
            "quantity_delta": "-2",
            "delta_unit": "PCS",
            "outcome": "MISMATCH",
        }
    ]
    assert staff.get(path).json()["import_id"] is None
    queue = f"{API}/intakes"
    assert TestClient(staff.app).get(queue).status_code == 401
    filtered = staff.get(queue, params={"q": key, "outcome": "MISMATCH"})
    assert filtered.status_code == 200, filtered.text
    matches = filtered.json()
    assert [row["id"] for row in matches] == [case_id]
    assert matches[0]["sender"] == metadata["sender"]
    assert staff.get(queue, params={"q": key, "outcome": "PASS"}).json() == []
    assert staff.get(queue, params={"q": "%"}).json() == []
    for term in ("demobl0001", "ABCD1234567", "test vessel 47", "580710"):
        response = staff.get(queue, params={"q": term, "include_checks": True})
        assert response.status_code == 200, response.text
        matching = [row for row in response.json() if row["id"] == case_id]
        assert len(matching) == 1
        assert matching[0]["review_checks"]["invoice_packing"] == "MISMATCH"
        assert set(matching[0]["document_roles"]) == {"invoice", "packing_list", "draft_bl"}
        assert matching[0]["issue_count"] > 0
    original_bill = next(
        doc for doc in staff.get(path).json()["documents"] if doc["mime"] == "application/pdf"
    )
    preview = f"{API}/documents/{original_bill['id']}/pages/1"
    assert TestClient(staff.app).get(f"{preview}/image").status_code == 401
    info = staff.get(preview, params={"line": 10, "rotation": 90})
    assert info.status_code == 200, info.text
    assert info.json()["pages"] == 1 and info.json()["width"] > info.json()["height"]
    assert all(0 < value < 1 for value in info.json()["box"])
    image = staff.get(f"{preview}/image")
    assert image.headers["content-type"] == "image/png"
    assert "no-store" in image.headers["cache-control"]
    assert image.content.startswith(b"\x89PNG")
    assert staff.get(preview.replace("/pages/1", "/pages/2")).status_code == 404
    with session_factory()() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(ReviewSnapshot)
                .where(ReviewSnapshot.intake_case_id == UUID(case_id))
            )
            == 1
        )
        assert (
            db.scalar(
                select(func.count())
                .select_from(DocumentExtraction)
                .join(ReviewSnapshot)
                .where(ReviewSnapshot.intake_case_id == UUID(case_id))
            )
            == 3
        )

    metadata = {
        "company": COMPANY,
        "year": "2026",
        "approval_ref": "QIP # DEMO-2026",
        "verified": "true",
    }
    payload = {"file": ("master.xlsx", master(), XLSX)}
    assert (
        staff.post(
            f"{API}/cdc/versions", data={**metadata, "company": "Wrong Ltd."}, files=payload
        ).status_code
        == 422
    )
    registered = staff.post(f"{API}/cdc/versions", data=metadata, files=payload)
    assert registered.status_code == 201, registered.text
    master_id = registered.json()["id"]
    assert staff.post(f"{API}/cdc/versions", data=metadata, files=payload).json()["id"] == master_id
    items_path = f"{API}/cdc/versions/{master_id}/items"
    assert TestClient(staff.app).get(items_path).status_code == 401
    catalog = staff.get(items_path, params={"q": "woven", "limit": 1}).json()
    assert catalog["total"] == 1
    assert catalog["items"][0]["description"]["value"] == "Woven label"
    assert staff.get(items_path, params={"q": "woven", "offset": 1}).json()["items"] == []
    assert (
        staff.post(
            f"{path}/cdc-version",
            json={"version_id": str(uuid4()), "expected_revision": result["revision"]},
        ).status_code
        == 404
    )
    apply = staff.post(
        f"{path}/cdc-version",
        json={"version_id": master_id, "expected_revision": result["revision"]},
    )
    assert apply.status_code == 202
    stale = staff.get(f"{path}/analysis").json()
    assert stale["analysis_revision"] == result["revision"] and stale["state"] == "pending"
    finish_queue()
    latest = staff.get(f"{path}/analysis").json()
    assert latest["analyzed_master"]["id"] == master_id and latest["candidates"]

    revision = staff.post(
        f"{API}/intakes/simulate",
        data={"intake_case_id": case_id, "parent_version_id": original_bill["id"]},
        files={"files": ("draft.pdf", draft_bill(weight="25.00"), "application/pdf")},
    )
    assert revision.status_code == 201, revision.text
    finish_queue()
    latest = staff.get(f"{path}/analysis").json()
    assert all(row["document_id"] != original_bill["id"] for row in latest["extractions"])
    original = staff.get(f"{API}/documents/{original_bill['id']}/download")
    assert original.status_code == 200
    assert original.content == replay_files()[1]
    details = staff.get(path).json()
    revised_bill = next(
        doc for doc in details["documents"] if doc["parent_version_id"] == original_bill["id"]
    )
    assert latest["extractions"][0]["document_id"] == revised_bill["id"]
    with session_factory()() as db:
        old = db.scalar(
            select(ReviewSnapshot).where(
                ReviewSnapshot.intake_case_id == UUID(case_id),
                ReviewSnapshot.revision == result["revision"],
            )
        )
        assert old is not None and old.findings == result["findings"]
    assert (
        staff.post(f"{path}/process", json={"expected_revision": result["revision"]}).json()[
            "revision"
        ]
        == latest["revision"]
    )


@pytest.mark.parametrize("missing_reference", [False, True])
def test_review_queue_distinguishes_passing_checks_from_missing_information(
    staff, missing_reference
):
    finish_queue()
    subject = f"workflow-fixture-{uuid4().hex}"
    receipt = staff.post(
        f"{API}/intakes/simulate",
        data={"subject": subject, "provider_message_id": subject},
        files=[
            ("files", ("supplier.xlsx", supplier(missing_ref=missing_reference), XLSX)),
            ("files", ("draft.pdf", draft_bill(), "application/pdf")),
        ],
    )
    assert receipt.status_code == 201, receipt.text
    case_id = receipt.json()["case_id"]
    finish_queue()
    response = staff.get(f"{API}/intakes", params={"q": subject, "include_checks": True})
    assert response.status_code == 200, response.text
    [case] = response.json()
    assert case["id"] == case_id
    assert case["review_checks"]["invoice_packing"] == "PASS"
    assert case["review_checks"]["transport"] == "PASS"
    assert case["review_checks"]["cdc"] == "NEEDS_REVIEW"
    if missing_reference:
        assert case["review_checks"]["extraction"] == "NEEDS_REVIEW"
        assert case["detected_reference"] is None
    else:
        assert case["detected_reference"] == REFERENCE
    assert staff.get(f"{API}/intakes/{case_id}").json()["import_id"] is None


def test_ollama_unavailable_keeps_deterministic_snapshot(staff, monkeypatch):
    from shipping_ai.automation.tasks import drain
    from shipping_ai.core.config import settings

    finish_queue()
    monkeypatch.setattr(settings(), "ollama_enabled", True)
    monkeypatch.setattr(
        httpx, "post", lambda *args, **kwargs: (_ for _ in ()).throw(httpx.ConnectError("offline"))
    )
    response = send(staff, uuid4().hex)
    assert response.status_code == 201, response.text
    path = f"{API}/intakes/{response.json()['case_id']}/analysis"
    drain.run()
    drain.run()
    pending = staff.get(path).json()
    assert pending["ai_state"] == "pending"
    drain.run()
    offline = staff.get(path).json()
    assert offline["ai_state"] == "unavailable" and offline["ai_suggestions"] == []
    assert offline["findings"] == pending["findings"] and offline["outcome"] == pending["outcome"]


def test_ollama_schema_rejects_unknown_finding(monkeypatch):
    config = Settings(
        database_url="postgresql+psycopg://localhost/shipping",
        redis_url="redis://localhost:6379/0",
        web_origin="http://localhost:3000",
        environment="test",
        ollama_enabled=True,
    )
    findings, _ = review_documents(documents(supplier(packing_description="金属拉链")))
    context = review_context(findings)
    assert context[0]["description_a"] and context[0]["description_b"]

    def response(key, repeated=False):
        output = {
            "suggestions": [
                {
                    "finding_key": key,
                    "relationship": "different",
                    "explanation": "Check the product term.",
                    "suggested_action": "verify_translation",
                }
            ]
        }
        import json

        if repeated:
            output["suggestions"] *= 2
        return httpx.Response(
            200,
            request=httpx.Request("POST", "http://localhost"),
            json={
                "done": True,
                "done_reason": "stop",
                "response": json.dumps(output),
            },
        )

    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, **kwargs: httpx.Response(
            200,
            request=httpx.Request("GET", url),
            json={"models": [{"name": config.ollama_model}]},
        ),
    )
    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: response("unrelated"))
    with pytest.raises(InvalidAdvisory):
        OllamaProvider(config).advise(context)
    monkeypatch.setattr(
        httpx, "post", lambda *args, **kwargs: response(context[0]["finding_key"], repeated=True)
    )
    suggestions = OllamaProvider(config).advise(context).suggestions
    assert len(suggestions) == 1 and suggestions[0].relationship == "different"


def test_cdc_price_discrepancy_in_comparable_units():
    invoice = documents()[0]
    parsed = parse_master(master(price="3.00"), "master.xlsx", uuid4())
    version = SimpleNamespace(
        company=COMPANY,
        company_key=company_key(COMPANY),
        year=2026,
        approval_ref="DEMO-2026",
        balance_as_of=datetime.now(UTC).date(),
        items=[item.model_dump(mode="json") for item in parsed.items],
    )
    findings, _ = check_cdc(invoice, version)
    price = next(f for f in findings if f.field == "unit_price")
    assert price.outcome == "MISMATCH"
    assert price.left == "2.50 USD PCS" and price.right == "3.00 USD PCS"
    assert {e.cell for e in price.evidence} == {"F10", "H3"}


def test_cdc_detect_categories():
    from shipping_ai.cdc.master import classify_item_description, detect_categories_for_rows

    rows = [
        (1, ["CIB 01E", "Company : Test Co"]),
        (7, ["I", "MACHINERIES AND EQUIPMENT"]),
        (8, ["1", "One needle sewing machine", "New", "Set", 100]),
        (15, ["SUB-TOTAL (I):", 50000]),
        (16, ["II-RAW MATERIALS AND ACCESSORIES"]),
        (17, ["1", "Cotton Fabric", "New", "YDS", 5000]),
    ]
    categories = detect_categories_for_rows(rows, "Sheet1")
    assert categories[8] == "Machinery & Equipment"
    assert categories[17] == "Raw Materials & Accessories"

    assert classify_item_description("Auto fabric cutting machine") == "Machinery & Equipment"
    assert classify_item_description("Woven main label") == "Raw Materials & Accessories"
    assert classify_item_description("Plastic polybag") == "Raw Materials & Accessories"
