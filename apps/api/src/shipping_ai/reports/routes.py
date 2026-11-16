from collections import defaultdict
from datetime import UTC, date, datetime, time
from decimal import Decimal
from io import BytesIO
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from openpyxl import Workbook
from sqlalchemy import func, select

from shipping_ai.core.access import case_access, visible_company
from shipping_ai.core.auth import DB, Staff
from shipping_ai.intakes.routes import Offset, PageSize
from shipping_ai.models import Company, ImportItem, ImportRecord, IntakeCase
from shipping_ai.permits.routes import workbook_response

router = APIRouter(prefix="/reports", tags=["reports"])
LOCAL = ZoneInfo("Asia/Phnom_Penh")


def local_start(day):
    return datetime.combine(day, time.min, tzinfo=LOCAL).astimezone(UTC)


def approved_query(db, start, end, company_id):
    filters = [ImportRecord.state == "approved", case_access(db)]
    if company_id:
        visible_company(db, company_id)
        filters.append(ImportRecord.company_id == company_id)
    if start:
        filters.append(ImportRecord.approved_at >= local_start(start))
    if end:
        filters.append(ImportRecord.approved_at < local_start(end))
    if start and end and start >= end:
        raise HTTPException(422, "Report end must be after start")
    return (
        select(
            ImportRecord.id,
            ImportRecord.invoice_no,
            Company.name,
            ImportRecord.supplier,
            ImportRecord.approved_at,
            ImportRecord.etd,
            ImportRecord.eta,
            ImportItem.currency,
            func.sum(ImportItem.amount).label("amount"),
        )
        .join(Company)
        .join(IntakeCase, ImportRecord.intake_case_id == IntakeCase.id)
        .join(ImportItem, ImportItem.import_id == ImportRecord.id)
        .where(*filters)
        .group_by(ImportRecord.id, Company.name, ImportItem.currency)
    )


def text_cell(sheet, row, column, value):
    cell = sheet.cell(row, column, value)
    if isinstance(value, str):
        cell.data_type = "s"
    return cell


@router.get("/imports")
def report(
    db: DB,
    _user: Staff,
    start: date | None = None,
    end: date | None = None,
    excel: bool = False,
    company_id: UUID | None = None,
    limit: PageSize = 100,
    offset: Offset = 0,
):
    approved = approved_query(db, start, end, company_id)
    ordered = approved.order_by(
        ImportRecord.approved_at.desc(), ImportRecord.id, ImportItem.currency
    )
    if not excel:
        rows = approved.subquery()
        count, imports = db.execute(
            select(func.count(), func.count(func.distinct(rows.c.id))).select_from(rows)
        ).one()
        totals = {
            code: str(amount)
            for code, amount in db.execute(
                select(rows.c.currency, func.sum(rows.c.amount))
                .group_by(rows.c.currency)
                .order_by(rows.c.currency)
            )
        }
        return {
            "imports": imports,
            "totals": totals,
            "total_rows": count,
            "rows": [
                {
                    "id": ident,
                    "invoice_no": invoice,
                    "company": company,
                    "supplier": supplier,
                    "approved_at": approved_at,
                    "etd": etd,
                    "eta": eta,
                    "currency": code,
                    "amount": str(amount),
                }
                for ident, invoice, company, supplier, approved_at, etd, eta, code, amount in db.execute(
                    ordered.offset(offset).limit(limit)
                )
            ],
        }

    totals = defaultdict(Decimal)
    imports = set()
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Approved imports"
    sheet.append(
        [
            "Invoice",
            "Company",
            "Supplier",
            "Approved (Cambodia)",
            "ETD (expected)",
            "ETA (expected)",
            "Currency",
            "Amount",
            "Import ID",
        ]
    )
    sheet.freeze_panes = "A2"
    for index, (ident, invoice, company, supplier, approved, etd, eta, code, amount) in enumerate(
        db.execute(ordered), start=2
    ):
        imports.add(ident)
        totals[code] += amount
        for col, value in enumerate(
            (
                invoice,
                company,
                supplier,
                approved.astimezone(LOCAL).replace(tzinfo=None),
                etd,
                eta,
                code,
                amount,
                str(ident),
            ),
            start=1,
        ):
            text_cell(sheet, index, col, value)
    sheet.auto_filter.ref = sheet.dimensions
    for col, width in zip("ABCDEFGHI", (20, 30, 30, 24, 17, 17, 12, 20, 40), strict=True):
        sheet.column_dimensions[col].width = width
    summary = workbook.create_sheet("Totals")
    summary.append(["Approved imports", len(imports)])
    summary.append(["Currency", "Approved amount"])
    for code, amount in sorted(totals.items()):
        summary.append([code, amount])
    output = BytesIO()
    workbook.save(output)
    workbook.close()
    return workbook_response(output.getvalue(), "approved-imports.xlsx")
