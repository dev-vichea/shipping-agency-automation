from datetime import UTC, datetime
from decimal import Decimal
from io import BytesIO
from uuid import uuid4

from openpyxl import load_workbook

from shipping_ai.core.db import session_factory
from shipping_ai.models import ImportItem, ImportRecord, IntakeCase


def test_report_pages_include_rows_past_100_and_keep_full_totals_and_export(staff):
    workspace = staff.post("/api/v1/workspaces", json={"name": "Report pagination"}).json()
    company = staff.post("/api/v1/companies", json={"name": "Synthetic report factory"}).json()
    report = "/api/v1/reports/imports"
    dates = {"start": "2026-02-01", "end": "2026-02-02", "company_id": company["id"]}
    approved_at = datetime(2026, 1, 31, 18, tzinfo=UTC)
    with session_factory().begin() as db:
        cases = [
            IntakeCase(
                id=uuid4(),
                workspace_id=workspace["id"],
                company_id=company["id"],
                channel="manual",
                state="approved",
            )
            for _ in range(101)
        ]
        db.add_all(cases)
        db.flush()
        records = [
            ImportRecord(
                id=uuid4(),
                intake_case_id=case.id,
                company_id=company["id"],
                invoice_no=f"REPORT-{i:03}",
                state="approved",
                approved_at=approved_at,
            )
            for i, case in enumerate(cases)
        ]
        db.add_all(records)
        db.flush()
        db.add_all(
            ImportItem(
                import_id=record.id,
                intake_case_id=record.intake_case_id,
                line_no=1,
                raw_description="Synthetic cargo",
                currency="USD",
                amount=Decimal("2.5"),
            )
            for record in records
        )
        db.add(
            ImportItem(
                import_id=records[0].id,
                intake_case_id=records[0].intake_case_id,
                line_no=2,
                raw_description="Synthetic cargo",
                currency="EUR",
                amount=Decimal("4"),
            )
        )

    first = staff.get(report, params=dates).json()
    last = staff.get(report, params={**dates, "limit": 30, "offset": 100}).json()
    totals = {"EUR": "4.000000", "USD": "252.500000"}
    assert first["totals"] == last["totals"] == totals
    assert first["imports"] == last["imports"] == 101
    assert first["total_rows"] == last["total_rows"] == 102
    assert len(first["rows"]) == 100
    assert len(last["rows"]) == 2
    assert len({(row["id"], row["currency"]) for row in first["rows"] + last["rows"]}) == 102
    assert staff.get(report, params={**dates, "offset": 102}).json()["rows"] == []
    assert staff.get(report, params={**dates, "offset": -1}).status_code == 422
    assert staff.get(report, params={**dates, "limit": 101}).status_code == 422

    exported = staff.get(report, params={**dates, "excel": "true", "offset": 100, "limit": 1})
    workbook = load_workbook(BytesIO(exported.content))
    assert workbook["Approved imports"].max_row == 103
    assert workbook["Totals"]["B1"].value == 101
    workbook.close()

    assert staff.post("/api/v1/workspaces", json={"name": "Other workspace"}).status_code == 201
    assert staff.get(report, params=dates).status_code == 404
    empty = staff.get(report).json()
    assert empty == {"imports": 0, "totals": {}, "total_rows": 0, "rows": []}
