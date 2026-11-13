from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

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


@router.post(
    "", status_code=201, response_model=ImportSummary, dependencies=[Depends(browser_origin)]
)
def create_draft(payload: CreateDraft, db: DB, user: Staff):
    case = db.get(IntakeCase, payload.intake_case_id, with_for_update=True)
    if not case:
        raise HTTPException(404, "Intake not found")
    if db.scalar(select(ImportRecord.id).where(ImportRecord.intake_case_id == case.id)):
        raise HTTPException(409, "This intake already has a draft")
    identity = " ".join(payload.company.split()).lower()
    if len(identity) > 254:
        raise HTTPException(422, "Company name is too long")
    company_id = db.scalar(
        insert(Company)
        .values(name=payload.company, identity_key=identity)
        .on_conflict_do_nothing(index_elements=[Company.identity_key])
        .returning(Company.id)
    )
    company = (
        db.get(Company, company_id)
        if company_id
        else db.scalar(select(Company).where(Company.identity_key == identity))
    )
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
def list_imports(db: DB, _user: Staff, limit: PageSize = 30, offset: Offset = 0):
    return [
        view(record, name)
        for record, name in db.execute(
            select(ImportRecord, Company.name)
            .join(Company)
            .order_by(ImportRecord.created_at.desc(), ImportRecord.id.desc())
            .offset(offset)
            .limit(limit)
        )
    ]


def get_import(db: DB, import_id: UUID) -> tuple[ImportRecord, str]:
    row = db.execute(
        select(ImportRecord, Company.name).join(Company).where(ImportRecord.id == import_id)
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
