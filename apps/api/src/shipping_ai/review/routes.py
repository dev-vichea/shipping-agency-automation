from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from shipping_ai.cdc.routes import view
from shipping_ai.core.auth import DB, Staff, browser_origin
from shipping_ai.models import (
    ActivityEvent,
    AutomationRun,
    CdcMasterVersion,
    DocumentExtraction,
    IntakeCase,
    ReviewSnapshot,
)

from .pipeline import enqueue
from .schemas import ReviewView

router = APIRouter(prefix="/intakes", tags=["document review"])


class ProcessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)


class MasterSelection(ProcessRequest):
    version_id: UUID | None


class QueuedReview(BaseModel):
    revision: int
    run_id: UUID | None


def get_case(db, case_id, *, lock=False):
    case = db.get(IntakeCase, case_id, with_for_update=lock)
    if not case:
        raise HTTPException(404, "Intake not found")
    return case


def queued_run(db, case):
    return db.scalar(
        select(AutomationRun).where(
            AutomationRun.intake_case_id == case.id,
            AutomationRun.input_revision == case.analysis_revision,
            AutomationRun.stage == "analysis",
        )
    )


@router.get("/{case_id}/analysis", response_model=ReviewView)
def review(case_id: UUID, db: DB, _user: Staff):
    case = get_case(db, case_id)
    run = queued_run(db, case)
    snapshot = db.scalar(
        select(ReviewSnapshot)
        .where(
            ReviewSnapshot.intake_case_id == case_id,
            ReviewSnapshot.revision <= case.analysis_revision,
        )
        .order_by(ReviewSnapshot.revision.desc())
        .limit(1)
    )
    master = (
        db.get(CdcMasterVersion, case.cdc_master_version_id) if case.cdc_master_version_id else None
    )
    output = dict(
        revision=case.analysis_revision,
        state="failed" if case.state == "failed" else "pending",
        selected_master=view(master),
        run_id=run.id if run else None,
        trace_id=run.trace_id if run else None,
    )
    if snapshot is None:
        return output
    analyzed_master = (
        db.get(CdcMasterVersion, snapshot.cdc_master_version_id)
        if snapshot.cdc_master_version_id
        else None
    )
    extractions = db.scalars(
        select(DocumentExtraction)
        .where(DocumentExtraction.snapshot_id == snapshot.id)
        .order_by(DocumentExtraction.role, DocumentExtraction.document_id)
    ).all()
    return {
        **output,
        "state": "available" if snapshot.revision == case.analysis_revision else output["state"],
        "analysis_revision": snapshot.revision,
        "outcome": snapshot.outcome,
        "rules_version": snapshot.rules_version,
        "extracted_at": snapshot.created_at,
        "extractions": [item.payload for item in extractions],
        "findings": snapshot.findings,
        "candidates": snapshot.candidates,
        "analyzed_master": view(analyzed_master),
        "ai_state": snapshot.ai_state,
        "ai_model": snapshot.ai_model,
        "ai_prompt_version": snapshot.ai_prompt_version,
        "ai_trace_id": snapshot.ai_trace_id,
        "ai_suggestions": snapshot.ai_suggestions,
    }


def queue_review(db, user, case, action):
    previous = case.state
    case.analysis_revision += 1
    case.state = "queued"
    case.review_reason = None
    case.detected_reference = None
    run_id = enqueue(db, case.id, case.analysis_revision)
    db.add(
        ActivityEvent(
            actor_type="staff",
            actor_id=user.id,
            intake_case_id=case.id,
            automation_run_id=run_id,
            event_type=action,
            before_state=previous,
            after_state="queued",
        )
    )
    db.commit()
    return QueuedReview(revision=case.analysis_revision, run_id=run_id)


@router.post(
    "/{case_id}/process",
    status_code=202,
    response_model=QueuedReview,
    dependencies=[Depends(browser_origin)],
)
def process(case_id: UUID, payload: ProcessRequest, db: DB, user: Staff):
    case = get_case(db, case_id, lock=True)
    existing = queued_run(db, case)
    if payload.expected_revision != case.analysis_revision or (
        existing and existing.state in {"queued", "running"}
    ):
        return QueuedReview(
            revision=case.analysis_revision, run_id=existing.id if existing else None
        )
    return queue_review(db, user, case, "analysis_requested")


@router.post(
    "/{case_id}/cdc-version",
    status_code=202,
    response_model=QueuedReview,
    dependencies=[Depends(browser_origin)],
)
def select_master(case_id: UUID, payload: MasterSelection, db: DB, user: Staff):
    case = get_case(db, case_id, lock=True)
    if payload.expected_revision != case.analysis_revision:
        raise HTTPException(409, "This intake changed. Refresh before selecting a Master List.")
    if case.cdc_master_version_id == payload.version_id:
        existing = queued_run(db, case)
        return QueuedReview(
            revision=case.analysis_revision, run_id=existing.id if existing else None
        )
    if payload.version_id and db.get(CdcMasterVersion, payload.version_id) is None:
        raise HTTPException(404, "CDC Master List version not found")
    case.cdc_master_version_id = payload.version_id
    return queue_review(db, user, case, "cdc_version_selected")
