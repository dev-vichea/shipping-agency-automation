from datetime import UTC, date, datetime
from hashlib import sha256
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select

from shipping_ai.cdc.reservations import plan
from shipping_ai.core.auth import DB, Staff, browser_origin
from shipping_ai.imports.routes import resolve_company
from shipping_ai.models import (
    ActivityEvent,
    Approval,
    CdcMasterVersion,
    CdcReservation,
    ImportItem,
    ImportRecord,
    PermitDraft,
    ReviewSnapshot,
    StaffReview,
)
from shipping_ai.permits.drafts import PROFILE, prepare, render
from shipping_ai.review.routes import get_case
from shipping_ai.review.schemas import Extraction
from shipping_ai.review.values import usable

from .review import Note, Revision, SaveReview, analysis, digest, latest_review, review_payload

router = APIRouter(prefix="/intakes", tags=["staff approval"])
mutation = [Depends(browser_origin)]


class Decision(Revision):
    review_id: UUID | None
    notes: Note


def review_view(review):
    if not review:
        return None
    return {
        "id": review.id,
        "actor_id": review.actor_id,
        "created_at": review.created_at,
        "ready": review.ready,
        "snapshot_hash": review.snapshot_hash,
        **{key: value for key, value in review.payload.items() if key != "documents"},
    }


def audit(db, case, user, action, state, record=None):
    db.add(
        ActivityEvent(
            actor_type="staff",
            actor_id=user.id,
            intake_case_id=case.id,
            import_record_id=record.id if record else None,
            event_type=action,
            before_state=case.state,
            after_state=state,
        )
    )
    case.state = state


@router.get("/{case_id}/review")
def get_review(case_id: UUID, db: DB, _user: Staff):
    case = get_case(db, case_id)
    events = db.scalars(
        select(Approval)
        .where(Approval.intake_case_id == case_id)
        .order_by(Approval.created_at.desc(), Approval.id.desc())
    ).all()
    return {
        "review": review_view(latest_review(db, case)),
        "decisions": [
            {
                "id": event.id,
                "scope": event.scope,
                "decision": event.decision,
                "actor_id": event.actor_id,
                "revision": event.revision,
                "created_at": event.created_at,
                "snapshot_hash": event.snapshot_hash,
                "review_id": event.staff_review_id,
                "notes": event.payload.get("notes"),
                "permit_pending": event.payload.get("permit_pending"),
                "recipient": event.payload.get("recipient"),
            }
            for event in events
        ],
    }


@router.get("/{case_id}/review/{review_id}")
def review_history(case_id: UUID, review_id: UUID, db: DB, _user: Staff):
    get_case(db, case_id)
    review = db.get(StaffReview, review_id)
    if not review or review.intake_case_id != case_id:
        raise HTTPException(404, "Staff review not found")
    return review_view(review)


@router.post("/{case_id}/review", dependencies=mutation)
def save_review(case_id: UUID, request: SaveReview, db: DB, user: Staff):
    case = get_case(db, case_id, lock=True)
    review = stage_review(db, case, request, user)
    db.commit()
    return review_view(review)


def stage_review(db, case, request, user, *, approval_request=None):
    previous = latest_review(db, case)
    if (
        case.state not in {"needs_review", "ready_for_approval"}
        or case.analysis_revision != request.expected_revision
        or request.expected_review_id != (previous.id if previous else None)
    ):
        raise HTTPException(409, "This review has changed. Refresh before saving.")
    snapshot, documents = analysis(db, case)
    payload = review_payload(db, snapshot, documents, request)
    if approval_request:
        if payload["blockers"]:
            raise HTTPException(409, payload["blockers"][0])
        payload["approval_request"] = approval_request
    ready = not payload["blockers"]
    staff_review = StaffReview(
        intake_case_id=case.id,
        revision=case.analysis_revision,
        actor_id=user.id,
        ready=ready,
        snapshot_hash=digest(payload),
        payload=payload,
    )
    db.add(staff_review)
    action = "correction_requested" if request.request_correction else "review_saved"
    audit(db, case, user, action, "ready_for_approval" if ready else "needs_review")
    case.review_reason = "Reviewed values ready for approval." if ready else payload["blockers"][0]
    db.flush()
    return staff_review


def result(event):
    return {
        "approval_id": event.id,
        "import_id": event.import_id,
        "decision": event.decision,
        "permit_pending": event.payload.get("permit_pending"),
    }


def prior_decision(db, case, request, decision):
    prior = db.scalar(
        select(Approval).filter_by(
            intake_case_id=case.id, revision=request.expected_revision, scope="intake"
        )
    )
    if prior and (
        prior.decision != decision
        or prior.staff_review_id != request.review_id
        or prior.payload.get("notes") != request.notes
    ):
        raise HTTPException(409, "This revision already has a different decision")
    return prior


def locked_review(db, case_id, request, decision):
    case = get_case(db, case_id, lock=True)
    prior = prior_decision(db, case, request, decision)
    if prior:
        return case, prior, None
    review = latest_review(db, case)
    if (
        case.analysis_revision != request.expected_revision
        or request.review_id != (review.id if review else None)
        or case.state not in {"needs_review", "ready_for_approval", "failed"}
    ):
        raise HTTPException(409, "This review has changed. Refresh before making a decision.")
    return case, None, review


@router.post("/{case_id}/reject", dependencies=mutation)
def reject(case_id: UUID, request: Decision, db: DB, user: Staff):
    case, prior, review = locked_review(db, case_id, request, "rejected")
    if prior:
        return result(prior)
    snapshot_id = db.scalar(
        select(ReviewSnapshot.id).filter_by(intake_case_id=case.id, revision=case.analysis_revision)
    )
    payload = {
        "notes": request.notes,
        "revision": request.expected_revision,
        "analysis_id": str(snapshot_id) if snapshot_id else None,
    }
    event = Approval(
        intake_case_id=case.id,
        staff_review_id=review.id if review else None,
        actor_id=user.id,
        revision=case.analysis_revision,
        scope="intake",
        decision="rejected",
        snapshot_hash=review.snapshot_hash if review else digest(payload),
        payload=payload,
    )
    db.add(event)
    audit(db, case, user, "intake_rejected", "rejected")
    case.review_reason = "Intake rejected by staff."
    db.commit()
    return result(event)


def reviewed_date(invoice, bill, key):
    for source in (bill, invoice):
        value = usable(source.fields.get(key)) if source else None
        if value:
            try:
                return date.fromisoformat(value)
            except ValueError:
                pass
    return None


@router.post("/{case_id}/approve", dependencies=mutation)
def approve(case_id: UUID, request: Decision, db: DB, user: Staff):
    case, prior, review = locked_review(db, case_id, request, "approved")
    if prior:
        return result(prior)
    if not review or not review.ready or case.state != "ready_for_approval":
        raise HTTPException(409, "Save a review with all required checks resolved before approval")
    payload = review.payload
    docs = [Extraction.model_validate(doc) for doc in payload["documents"]]
    invoice = next(doc for doc in docs if doc.role == "invoice")
    packing = next(doc for doc in docs if doc.role == "packing_list")
    bills = [doc for doc in docs if doc.role == "draft_bl"]
    bill = bills[0] if len(bills) == 1 else None
    master = db.get(CdcMasterVersion, UUID(payload["master_id"])) if payload["master_id"] else None
    arguments, pending = prepare(invoice, packing, master, payload["mappings"])

    company = resolve_company(db, usable(invoice.fields["consignee"]), case)
    case.company_id = company.id
    record = db.scalar(select(ImportRecord).where(ImportRecord.intake_case_id == case.id))
    if record is None:
        record = ImportRecord(intake_case_id=case.id)
        db.add(record)
    record.company_id = company.id
    record.invoice_no = usable(invoice.fields["invoice_no"])
    record.supplier = usable(invoice.fields["supplier"])
    record.consignee = usable(invoice.fields["consignee"])
    record.state = "approved"
    record.approved_at = datetime.now(UTC)
    for key in ("etd", "eta"):
        value = reviewed_date(invoice, bill, key)
        setattr(record, key, value)
        setattr(record, f"{key}_status", "expected" if value else "pending")
    db.flush()
    reservations = plan(db, record, master, invoice, payload["mappings"], arguments is not None)
    workbook = render(arguments) if arguments is not None else None
    db.execute(delete(ImportItem).where(ImportItem.import_id == record.id))
    raw_invoice = next(
        doc
        for doc in analysis(db, case)[1]
        if doc.document_id == invoice.document_id and doc.role == "invoice"
    )
    originals = {item.row: item for item in raw_invoice.items}
    for line_no, item in enumerate(invoice.items, start=1):
        fields = item.fields
        original = originals[item.row].fields["description"]
        evidence = next(iter(original.evidence), None)
        locator = f"{invoice.sheet or 'Invoice'} · row {item.row}"
        if evidence and evidence.page:
            locator = f"PDF page {evidence.page} · item {item.row}"
        description = (
            arguments[2][line_no - 1]["english_provided"] if arguments
            else usable(fields.get("english_description")) or usable(fields["description"])
        )
        db.add(
            ImportItem(
                import_id=record.id,
                intake_case_id=case.id,
                line_no=line_no,
                source_document_id=invoice.document_id,
                source_locator=locator[:255],
                raw_description=original.original_text or original.value or "",
                normalized_description=description,
                quantity=usable(fields["quantity"]),
                unit=usable(fields["unit"]),
                currency=fields["amount"].currency,
                unit_price=usable(fields["unit_price"]),
                amount=usable(fields["amount"]),
                verification_state="reviewed",
            )
        )
    event = Approval(
        intake_case_id=case.id,
        import_id=record.id,
        staff_review_id=review.id,
        actor_id=user.id,
        revision=case.analysis_revision,
        scope="intake",
        decision="approved",
        snapshot_hash=review.snapshot_hash,
        payload={
            "notes": request.notes,
            "permit_pending": pending,
            "permit_generated": workbook is not None,
            "permit_profile": PROFILE,
            "internal_reservations": [
                {
                    "master_id": str(master.id),
                    "master_row": row,
                    "quantity": str(qty),
                    "amount": str(amount),
                }
                for row, (qty, amount) in reservations.items()
            ],
        },
    )
    db.add(event)
    db.flush()
    if reservations:
        db.execute(delete(CdcReservation).where(CdcReservation.import_id == record.id))
        db.add_all(
            CdcReservation(
                import_id=record.id,
                master_id=master.id,
                master_row=row,
                approval_id=event.id,
                quantity=qty,
                amount=amount,
            )
            for row, (qty, amount) in reservations.items()
        )
    if workbook:
        db.add(
            PermitDraft(
                approval_id=event.id,
                import_id=record.id,
                content=workbook,
                sha256=sha256(workbook).hexdigest(),
            )
        )
    audit(db, case, user, "intake_approved", "approved", record)
    case.detected_reference = record.invoice_no
    case.review_reason = "Staff approved the import."
    db.commit()
    return result(event)


class ReviewApproval(SaveReview):
    notes: Note


@router.post("/{case_id}/review-and-approve", dependencies=mutation)
def review_and_approve(case_id: UUID, request: ReviewApproval, db: DB, user: Staff):
    if request.request_correction:
        raise HTTPException(422, "Resolve the requested correction before approving")
    case = get_case(db, case_id, lock=True)
    key = digest(request.model_dump(mode="json"))
    prior = db.scalar(
        select(Approval).filter_by(
            intake_case_id=case_id,
            revision=request.expected_revision,
            scope="intake",
        )
    )
    if prior:
        prior_review = db.get(StaffReview, prior.staff_review_id) if prior.staff_review_id else None
        if (
            prior.decision == "approved"
            and prior_review
            and prior_review.payload.get("approval_request") == key
        ):
            return result(prior)
        raise HTTPException(409, "This revision already has a different decision")
    review_request = SaveReview.model_validate(request.model_dump(exclude={"notes"}))
    review = stage_review(db, case, review_request, user, approval_request=key)
    return approve(
        case_id,
        Decision(
            expected_revision=request.expected_revision, review_id=review.id, notes=request.notes
        ),
        db,
        user,
    )
