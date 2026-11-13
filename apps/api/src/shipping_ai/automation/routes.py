from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from shipping_ai.core.auth import DB, Staff, browser_origin
from shipping_ai.intakes.routes import Offset, PageSize
from shipping_ai.intakes.schemas import ORM
from shipping_ai.models import ActivityEvent, AutomationRun, IntakeCase, ReviewSnapshot

router = APIRouter(prefix="/automation", tags=["automation"])


class RunView(ORM):
    id: UUID
    trace_id: UUID
    intake_case_id: UUID | None
    stage: str
    state: str
    attempt: int
    retry_count: int
    created_at: datetime
    available_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    error_code: str | None


@router.get("/runs", response_model=list[RunView])
def runs(db: DB, _user: Staff, limit: PageSize = 30, offset: Offset = 0):
    return db.scalars(
        select(AutomationRun)
        .order_by(AutomationRun.created_at.desc(), AutomationRun.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()


@router.post(
    "/health-check", status_code=202, response_model=RunView, dependencies=[Depends(browser_origin)]
)
def health_check(db: DB, user: Staff):
    run = AutomationRun(event_key=f"health:{uuid4()}", stage="health_check")
    db.add(run)
    db.flush()
    db.add(
        ActivityEvent(
            actor_type="staff",
            actor_id=user.id,
            automation_run_id=run.id,
            event_type="health_check_queued",
            after_state="queued",
        )
    )
    db.commit()
    return run


@router.post(
    "/runs/{run_id}/retry",
    status_code=202,
    response_model=RunView,
    dependencies=[Depends(browser_origin)],
)
def retry(run_id: UUID, db: DB, user: Staff):
    original = db.get(AutomationRun, run_id)
    case = (
        db.get(IntakeCase, original.intake_case_id, with_for_update=True)
        if original and original.intake_case_id
        else None
    )
    run = db.get(AutomationRun, run_id, with_for_update=True, populate_existing=True)
    if not run:
        raise HTTPException(404, "Run not found")
    if case and run.input_revision != case.analysis_revision:
        raise HTTPException(409, "This run belongs to an older intake revision")
    if run.state == "queued":
        return run
    if run.state != "failed":
        raise HTTPException(409, "Only failed runs can be retried")
    run.state = "queued"
    run.retry_count = 0
    run.error_code = None
    run.available_at = datetime.now(UTC)
    run.ended_at = None
    run.started_at = None
    if case and run.stage == "ai":
        snapshot = db.scalar(
            select(ReviewSnapshot).filter_by(intake_case_id=case.id, revision=run.input_revision)
        )
        if snapshot:
            snapshot.ai_state = "pending"
    elif case:
        case.state = "queued"
        case.review_reason = None
    db.add(
        ActivityEvent(
            actor_type="staff",
            actor_id=user.id,
            intake_case_id=run.intake_case_id,
            automation_run_id=run.id,
            event_type="automation_retry_requested",
            before_state="failed",
            after_state="queued",
        )
    )
    db.commit()
    return run
