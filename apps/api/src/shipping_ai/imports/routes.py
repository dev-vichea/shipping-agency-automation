from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert

from shipping_ai.core.access import (
    case_access,
    company_access,
    require_workspace,
    visible_case,
    visible_company,
)
from shipping_ai.core.auth import DB, Staff, browser_origin
from shipping_ai.intakes.routes import Offset, PageSize
from shipping_ai.intakes.schemas import ORM, DocumentView, Key, Label
from shipping_ai.models import (
    ActivityEvent,
    Company,
    Document,
    ImportItem,
    ImportRecord,
    IntakeCase,
)

router = APIRouter(prefix="/imports", tags=["imports"])


class CreateDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intake_case_id: UUID
    company: Label
    invoice_no: Key
    supplier: Label | None = None
    consignee: Label | None = None


class ImportSummary(ORM):
    id: UUID
    intake_case_id: UUID
    company_id: UUID
    company: str
    invoice_no: str
    supplier: str | None
    consignee: str | None
    state: str
    etd: date | None
    eta: date | None
    etd_status: str
    eta_status: str
    created_at: datetime
    approved_at: datetime | None


class ItemView(ORM):
    id: UUID
    line_no: int
    raw_description: str
    normalized_description: str | None
    quantity: Decimal | None
    unit: str | None
    currency: str | None
    unit_price: Decimal | None
    amount: Decimal | None
    verification_state: str
    source_document_id: UUID | None
    source_locator: str | None


class ImportDetail(ImportSummary):
    documents: list[DocumentView]
    items: list[ItemView]


def view(record: ImportRecord, name: str) -> ImportSummary:
    return ImportSummary.model_validate(
        {
            key: name if key == "company" else getattr(record, key)
            for key in ImportSummary.model_fields
        }
    )


def resolve_company(db, name, case):
    identity = " ".join(name.split()).lower()
    if case.company_id:
        company = visible_company(db, case.company_id)
        if identity not in {
            company.identity_key,
            *(" ".join(alias.split()).lower() for alias in company.aliases),
        }:
            raise HTTPException(
                422, "The consignee must match the assigned company name or an alias"
            )
        return company
    workspace = require_workspace(db, admin=True)
    matches = [
        company
        for company in db.scalars(select(Company).where(company_access(db)))
        if identity
        in {company.identity_key, *(" ".join(alias.split()).lower() for alias in company.aliases)}
    ]
    if len(matches) > 1:
        raise HTTPException(409, "Assign the intake to the correct company before approving it")
    if matches:
        return matches[0]
    if len(identity) > 254:
        raise HTTPException(422, "Company name is too long")
    company_id = db.scalar(
        insert(Company)
        .values(name=name, identity_key=identity, workspace_id=workspace)
        .on_conflict_do_nothing(constraint="uq_company_workspace_identity")
        .returning(Company.id)
    )
    return (
        db.get(Company, company_id)
        if company_id
        else db.scalar(
            select(Company).where(
                Company.workspace_id == workspace, Company.identity_key == identity
            )
        )
    )


@router.post(
    "", status_code=201, response_model=ImportSummary, dependencies=[Depends(browser_origin)]
)
def create_draft(payload: CreateDraft, db: DB, user: Staff):
    case = visible_case(db, payload.intake_case_id, lock=True)
    if case.state == "rejected":
        raise HTTPException(409, "This intake was rejected")
    if db.scalar(select(ImportRecord.id).where(ImportRecord.intake_case_id == case.id)):
        raise HTTPException(409, "This intake already has an import")
    company = resolve_company(db, payload.company, case)
    case.company_id = company.id
    record = ImportRecord(
        intake_case_id=case.id,
        company_id=company.id,
        invoice_no=payload.invoice_no,
        supplier=payload.supplier,
        consignee=payload.consignee,
    )
    db.add(record)
    db.flush()
    db.add(
        ActivityEvent(
            actor_type="staff",
            actor_id=user.id,
            intake_case_id=case.id,
            import_record_id=record.id,
            event_type="import_draft_created",
            after_state="draft",
        )
    )
    db.commit()
    return view(record, company.name)


@router.get("", response_model=list[ImportSummary])
def list_imports(
    db: DB,
    _user: Staff,
    limit: PageSize = 30,
    offset: Offset = 0,
    company_id: UUID | None = None,
    q: Annotated[str, Query(max_length=160)] = "",
    state: Literal["draft", "approved"] | None = None,
    oldest_first: bool = False,
):
    filters = [case_access(db)]
    if company_id:
        visible_company(db, company_id)
        filters.append(ImportRecord.company_id == company_id)
    if state:
        filters.append(ImportRecord.state == state)
    if q.strip():
        filters.append(
            or_(
                ImportRecord.invoice_no.icontains(q.strip(), autoescape=True),
                Company.name.icontains(q.strip(), autoescape=True),
            )
        )
    return [
        view(record, name)
        for record, name in db.execute(
            select(ImportRecord, Company.name)
            .join(Company)
            .join(IntakeCase, ImportRecord.intake_case_id == IntakeCase.id)
            .where(*filters)
            .order_by(
                ImportRecord.created_at.asc() if oldest_first else ImportRecord.created_at.desc(),
                ImportRecord.id,
            )
            .offset(offset)
            .limit(limit)
        )
    ]


def get_import(db: DB, import_id: UUID) -> tuple[ImportRecord, str]:
    row = db.execute(
        select(ImportRecord, Company.name)
        .join(Company)
        .join(IntakeCase, ImportRecord.intake_case_id == IntakeCase.id)
        .where(ImportRecord.id == import_id, case_access(db))
    ).one_or_none()
    if row is None:
        raise HTTPException(404, "Import draft not found")
    return row[0], row[1]


def originals(db: DB, record: ImportRecord):
    return db.scalars(
        select(Document)
        .where(Document.intake_case_id == record.intake_case_id)
        .order_by(Document.received_at.desc(), Document.id.desc())
    ).all()


@router.get("/{import_id}", response_model=ImportDetail)
def import_detail(import_id: UUID, db: DB, _user: Staff):
    record, company = get_import(db, import_id)
    items = db.scalars(
        select(ImportItem).where(ImportItem.import_id == import_id).order_by(ImportItem.line_no)
    ).all()
    return {
        **view(record, company).model_dump(),
        "documents": originals(db, record),
        "items": items,
    }


@router.get("/{import_id}/documents", response_model=list[DocumentView])
def list_originals(import_id: UUID, db: DB, _user: Staff):
    record, _ = get_import(db, import_id)
    return originals(db, record)
