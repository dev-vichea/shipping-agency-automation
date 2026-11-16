from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy import select

from shipping_ai.approvals.review import Note, digest
from shipping_ai.core.auth import DB, Staff, browser_origin
from shipping_ai.imports.routes import get_import
from shipping_ai.models import ActivityEvent, Approval, IntakeCase, PermitDraft

router = APIRouter(prefix="/imports", tags=["permit drafts"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class PermitView(BaseModel):
    id: UUID
    sha256: str
    created_at: datetime
    revision: int
    current: bool
    recipient: str | None


class Release(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recipient: EmailStr
    notes: Note


def workbook_response(content: bytes, name: str):
    return Response(
        content,
        media_type=XLSX,
        headers={
            "Content-Disposition": f'attachment; filename="{name}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/{import_id}/permit-drafts", response_model=list[PermitView])
def permit_drafts(import_id: UUID, db: DB, _user: Staff):
    record, _ = get_import(db, import_id)
    case = db.get(IntakeCase, record.intake_case_id)
    releases = {
        event.revision: event.payload["recipient"]
        for event in db.scalars(
            select(Approval).filter_by(import_id=import_id, scope="permit_release")
        )
    }
    return [
        PermitView(
            id=draft.id,
            sha256=draft.sha256,
            created_at=draft.created_at,
            revision=revision,
            current=case.state == "approved" and revision == case.analysis_revision,
            recipient=releases.get(revision),
        )
        for draft, revision in db.execute(
            select(PermitDraft, Approval.revision)
            .join(Approval, PermitDraft.approval_id == Approval.id)
            .where(PermitDraft.import_id == import_id)
            .order_by(PermitDraft.created_at.desc(), PermitDraft.id.desc())
        )
    ]


def get_draft(db, import_id, draft_id):
    get_import(db, import_id)
    draft = db.get(PermitDraft, draft_id)
    if not draft or draft.import_id != import_id:
        raise HTTPException(404, "Permit draft not found")
    return draft


@router.get("/{import_id}/permit-drafts/{draft_id}/download")
def download(import_id: UUID, draft_id: UUID, db: DB, _user: Staff):
    return workbook_response(
        get_draft(db, import_id, draft_id).content, f"permit-draft-{draft_id}.xlsx"
    )


@router.post(
    "/{import_id}/permit-drafts/{draft_id}/release", dependencies=[Depends(browser_origin)]
)
def authorize_release(import_id: UUID, draft_id: UUID, request: Release, db: DB, user: Staff):
    draft = get_draft(db, import_id, draft_id)
    source = db.get(Approval, draft.approval_id)
    case = db.get(IntakeCase, source.intake_case_id, with_for_update=True)
    payload = {
        "draft_id": str(draft.id),
        "sha256": draft.sha256,
        "recipient": str(request.recipient),
        "notes": request.notes,
    }
    prior = db.scalar(
        select(Approval).filter_by(
            intake_case_id=case.id, revision=source.revision, scope="permit_release"
        )
    )
    if prior:
        if prior.payload != payload:
            raise HTTPException(
                409, "This permit draft already has a different release authorization"
            )
        return {"id": prior.id, "state": "authorized", "recipient": prior.payload["recipient"]}
    if case.state != "approved" or case.analysis_revision != source.revision:
        raise HTTPException(409, "Authorize release only for the current approved permit draft")
    event = Approval(
        intake_case_id=case.id,
        revision=source.revision,
        import_id=import_id,
        staff_review_id=source.staff_review_id,
        actor_id=user.id,
        scope="permit_release",
        decision="authorized",
        snapshot_hash=digest(payload),
        payload=payload,
    )
    db.add(event)
    db.add(
        ActivityEvent(
            actor_type="staff",
            actor_id=user.id,
            intake_case_id=case.id,
            import_record_id=import_id,
            event_type="permit_release_authorized",
            before_state=case.state,
            after_state=case.state,
        )
    )
    db.commit()
    return {"id": event.id, "state": "authorized", "recipient": payload["recipient"]}
