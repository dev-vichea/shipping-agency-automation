from datetime import date
from decimal import Decimal
from hashlib import sha256
from json import dumps
from typing import Annotated, Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select

from shipping_ai.cdc.master import check_cdc
from shipping_ai.intakes.schemas import SafeText
from shipping_ai.models import CdcMasterVersion, DocumentExtraction, ReviewSnapshot, StaffReview
from shipping_ai.permits.drafts import prepare
from shipping_ai.review.compare import AMOUNT_TOLERANCE, review_documents
from shipping_ai.review.schemas import Extraction
from shipping_ai.review.values import clean, currency, decimal, field, unit, usable

Note = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000), SafeText
]
Value = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=350), SafeText
]
Role = Literal["invoice", "packing_list", "draft_bl"]
NUMBERS = {"quantity", "packages", "gross_weight", "net_weight", "unit_price", "amount"}
DATES = {"invoice_date", "issue_date", "etd", "eta"}


class Revision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)


class Correction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: UUID
    role: Role
    row: int | None = Field(default=None, ge=1, le=5000)
    name: Annotated[str, StringConstraints(pattern=r"^[a-z_]{1,32}$")]
    value: Value
    unit: Value | None = None
    currency: Value | None = None
    note: Note


class Resolution(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: Annotated[str, StringConstraints(min_length=1, max_length=160), SafeText]
    note: Note


class Mapping(BaseModel):
    model_config = ConfigDict(extra="forbid")
    invoice_row: int = Field(ge=1, le=5000)
    master_row: int = Field(ge=1, le=5000)


class SaveReview(Revision):
    expected_review_id: UUID | None
    corrections: list[Correction] = Field(default_factory=list, max_length=300)
    resolutions: list[Resolution] = Field(default_factory=list, max_length=150)
    mappings: list[Mapping] = Field(default_factory=list, max_length=200)
    verify_cdc_mappings: bool = False
    request_correction: Note | None = None


def digest(payload: dict) -> str:
    return sha256(dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def latest_review(db, case):
    return db.scalar(
        select(StaffReview)
        .where(
            StaffReview.intake_case_id == case.id, StaffReview.revision == case.analysis_revision
        )
        .order_by(StaffReview.created_at.desc(), StaffReview.id.desc())
        .limit(1)
    )


def analysis(db, case):
    snapshot = db.scalar(
        select(ReviewSnapshot).filter_by(intake_case_id=case.id, revision=case.analysis_revision)
    )
    if snapshot is None:
        raise HTTPException(409, "The current analysis is still pending")
    docs = [
        Extraction.model_validate(value)
        for value in db.scalars(
            select(DocumentExtraction.payload)
            .where(DocumentExtraction.snapshot_id == snapshot.id)
            .order_by(DocumentExtraction.role, DocumentExtraction.document_id)
        )
    ]
    return snapshot, docs


def checked_number(value):
    number = decimal(value)
    if number is None or not 0 <= number < Decimal("100000000000000"):
        return None
    if number != number.quantize(Decimal("0.000001")):
        return None
    return number


def apply_corrections(docs, corrections):
    index = {(doc.document_id, doc.role): doc for doc in docs}
    seen = set()
    changes = []
    for edit in corrections:
        key = (edit.document_id, edit.role, edit.row, edit.name)
        doc = index.get(key[:2])
        row = next((item for item in doc.items if item.row == edit.row), None) if doc else None
        values = (row.fields if row else None) if edit.row else (doc.fields if doc else None)
        if key in seen or values is None or edit.name not in values:
            raise HTTPException(422, "A correction does not identify a unique extracted field")
        seen.add(key)
        original = values[edit.name]
        value = clean(edit.value)
        dimension, code = original.unit, original.currency
        if edit.name in NUMBERS:
            number = checked_number(value)
            if number is None:
                raise HTTPException(422, "Use a nonnegative number with up to six decimal places")
            value = str(number)
            if edit.unit:
                dimension = unit(edit.unit)
            if edit.currency:
                code = currency(edit.currency)
                if not code or len(edit.currency) != 3:
                    raise HTTPException(422, "Use a supported three-letter currency code")
            if edit.name in {"unit_price", "amount"} and not code:
                raise HTTPException(422, "Enter the currency for this price or amount")
        elif edit.name in DATES:
            try:
                value = date.fromisoformat(value).isoformat()
            except ValueError:
                raise HTTPException(422, "Use a calendar date in YYYY-MM-DD format") from None
        elif edit.name == "unit":
            value = unit(value)
        if not value:
            raise HTTPException(422, "A correction must supply a value")
        if edit.name == "invoice_no" and len(value) > 160:
            raise HTTPException(422, "Invoice reference is too long")
        values[edit.name] = field(value, *original.evidence, unit=dimension, currency=code)
        changes.append(
            {
                "edit": edit.model_dump(mode="json"),
                "before": original.model_dump(mode="json"),
                "after": values[edit.name].model_dump(mode="json"),
            }
        )

    for doc in docs:
        for item in doc.items:
            dimension = usable(item.fields.get("unit"))
            for name in ("quantity", "unit_price"):
                if dimension and name in item.fields:
                    item.fields[name].unit = dimension
    return changes


def blockers_for(docs, resolutions):
    findings, roles = review_documents(docs)
    invoice, packing = roles.get("invoice"), roles.get("packing_list")
    blockers = []
    for doc, keys, title in (
        (invoice, ("invoice_no", "supplier", "consignee"), "Invoice"),
        (packing, (), "Packing list"),
    ):
        if not doc or not doc.items:
            blockers.append(f"{title} with line items is required.")
            continue
        for key in keys:
            value = usable(doc.fields.get(key))
            if not value or len(value) > (160 if key == "invoice_no" else 254):
                blockers.append(f"{title} {key.replace('_', ' ')} is required.")
    if invoice:
        for item in invoice.items:
            f = item.fields
            quantity, price, amount = (
                checked_number(usable(f[key])) for key in ("quantity", "unit_price", "amount")
            )
            if not usable(f["description"]) or not usable(f["unit"]) or not quantity:
                blockers.append(
                    f"Invoice row {item.row} requires a description, positive quantity and unit."
                )
            if (
                price is None
                or amount is None
                or not f["amount"].currency
                or f["amount"].currency != f["unit_price"].currency
            ):
                blockers.append(
                    f"Invoice row {item.row} requires a price and amount in the same currency."
                )
            elif quantity and abs(quantity * price - amount) > AMOUNT_TOLERANCE:
                blockers.append(f"Invoice row {item.row} quantity × price differs from its amount.")

    for check in findings:
        if check.outcome not in {"MISMATCH", "NEEDS_REVIEW"}:
            continue
        if check.group == "invoice_packing":
            if (
                check.field == "description"
                and ".unpaired." not in check.key
                and check.key in resolutions
            ):
                continue
        elif check.group == "validation":
            if check.field == "currency_uniformity" and check.outcome == "NEEDS_REVIEW":
                continue
        elif check.group == "transport":
            if check.outcome == "NEEDS_REVIEW" and check.key in resolutions:
                continue
        else:
            continue
        blockers.append(f"{check.key}: {check.explanation}")
    return blockers, roles, findings


def review_payload(db, snapshot, docs, request):
    changes = apply_corrections(docs, request.corrections)
    resolutions = {entry.key: entry.note for entry in request.resolutions}
    if len(resolutions) != len(request.resolutions):
        raise HTTPException(422, "Each finding can be resolved once")
    blockers, roles, findings = blockers_for(docs, resolutions)
    if any(check["field"] == "document_limit" for check in snapshot.findings):
        blockers.append("Analysis did not cover all active documents.")
    reviewable = {
        check.key
        for check in findings
        if check.outcome == "NEEDS_REVIEW"
        and (
            check.group == "transport"
            or (
                check.group == "invoice_packing"
                and check.field == "description"
                and ".unpaired." not in check.key
            )
        )
    }
    if not resolutions.keys() <= reviewable:
        raise HTTPException(
            422,
            "Resolve wording or uncertain transport findings with a note. Correct source conflicts in the reviewed fields.",
        )
    invoice = roles.get("invoice")
    master = (
        db.get(CdcMasterVersion, snapshot.cdc_master_version_id)
        if snapshot.cdc_master_version_id
        else None
    )
    cdc_findings, candidates = check_cdc(invoice, master)
    master_rows = {item["row"] for item in master.items} if master else set()
    options = {(c.invoice_document_id, c.invoice_row, c.master_row) for c in candidates} | (
        {(invoice.document_id, item.row, m_row) for item in invoice.items for m_row in master_rows}
        if invoice and master
        else set()
    )
    selected = {(m.invoice_row, m.master_row) for m in request.mappings}
    if selected and not request.verify_cdc_mappings:
        raise HTTPException(422, "Confirm the selected CDC rows were checked against the source.")
    if len({m.invoice_row for m in request.mappings}) != len(request.mappings) or any(
        invoice is None or (invoice.document_id, row, master_row) not in options
        for row, master_row in selected
    ):
        raise HTTPException(422, "Choose one current CDC candidate per invoice row")
    if request.request_correction:
        blockers.insert(
            0, "A staff correction was requested. Save a new review after resolving it."
        )
    permit_pending = None
    if not blockers:
        _, permit_pending = prepare(
            invoice, roles["packing_list"], master, request.model_dump()["mappings"]
        )
    payload = {
        **request.model_dump(mode="json", exclude={"expected_review_id"}),
        "analysis_id": str(snapshot.id),
        "master_id": str(snapshot.cdc_master_version_id)
        if snapshot.cdc_master_version_id
        else None,
        "documents": [doc.model_dump(mode="json") for doc in docs],
        "findings": [check.model_dump(mode="json") for check in findings],
        "changes": changes,
        "cdc_findings": [check.model_dump(mode="json") for check in cdc_findings],
        "candidates": [candidate.model_dump(mode="json") for candidate in candidates],
        "blockers": blockers,
        "permit_pending": permit_pending,
    }
    return payload
