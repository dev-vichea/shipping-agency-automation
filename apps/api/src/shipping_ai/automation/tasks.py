from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from celery import Celery
from celery.utils.log import get_task_logger
from sqlalchemy import and_, or_, select, text

from shipping_ai.core.config import settings
from shipping_ai.core.db import session_factory
from shipping_ai.documents.storage import LocalStorage
from shipping_ai.models import ActivityEvent, AutomationRun, Document, IntakeCase

MAX_RETRIES = 3
LEASE = timedelta(minutes=2)
log = get_task_logger(__name__)
celery = Celery("shipping_ai", broker=str(settings().redis_url))
celery.conf.update(
    accept_content=["json"],
    task_serializer="json",
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    broker_connection_retry_on_startup=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        "drain-postgres-outbox": {
            "task": "shipping.drain",
            "schedule": 3.0,
            "options": {"expires": 10},
        }
    },
)


@dataclass(frozen=True)
class Claim:
    id: UUID
    attempt: int
    stage: str
    message_id: UUID | None
    trace_id: UUID
    exhausted: bool


def claim() -> Claim | None:
    now = datetime.now(UTC)
    with session_factory().begin() as db:
        run = db.scalar(
            select(AutomationRun)
            .where(
                or_(
                    and_(AutomationRun.state == "queued", AutomationRun.available_at <= now),
                    and_(AutomationRun.state == "running", AutomationRun.lease_until <= now),
                )
            )
            .order_by(AutomationRun.available_at, AutomationRun.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if not run:
            return None
        exhausted = False
        if run.state == "running":
            run.error_code = "lease_expired"
            if run.retry_count >= MAX_RETRIES:
                exhausted = True
            else:
                run.retry_count += 1
        run.state = "running"
        run.attempt += 1
        run.started_at = now
        run.lease_until = now + LEASE
        return Claim(run.id, run.attempt, run.stage, run.message_id, run.trace_id, exhausted)


def verify_receipt(message_id: UUID | None) -> str | None:
    if message_id is None:
        return "receipt_missing_message"
    with session_factory()() as db:
        files = db.execute(
            select(Document.storage_key, Document.size_bytes).where(
                Document.source_message_id == message_id
            )
        ).all()
    store = LocalStorage(settings().storage_dir)
    for key, size in files:
        try:
            if not store.verify(key, size):
                return "attachment_checksum_mismatch"
        except FileNotFoundError:
            return "attachment_unavailable"
    return None


def finish(job: Claim, error: str | None) -> None:
    now = datetime.now(UTC)
    with session_factory().begin() as db:
        run = db.get(AutomationRun, job.id, with_for_update=True)
        if not run or run.state != "running" or run.attempt != job.attempt:
            return  # stale completion or delivery
        run.error_code = error
        run.lease_until = None
        if error and run.retry_count < MAX_RETRIES and not job.exhausted:
            run.retry_count += 1
            run.available_at = now + timedelta(seconds=5 * 2 ** (run.retry_count - 1))
            run.state = "queued"
            return
        run.ended_at = now
        run.state = "failed" if error else "succeeded"

        case = (
            db.get(IntakeCase, run.intake_case_id, with_for_update=True)
            if run.intake_case_id
            else None
        )
        previous = case.state if case else None
        if case:
            db.flush()
            states = set(
                db.scalars(
                    select(AutomationRun.state).where(AutomationRun.intake_case_id == case.id)
                )
            )
            if states & {"queued", "running"}:
                case.state = "queued"
                case.review_reason = None
            elif "failed" in states:
                case.state = "failed"
                case.review_reason = "An attachment check failed. See Automation for details."
            else:
                case.state = "needs_review"
                case.review_reason = (
                    "Originals archived. Extraction and approval are not available yet."
                )
        db.add(
            ActivityEvent(
                actor_type="worker",
                intake_case_id=run.intake_case_id,
                automation_run_id=run.id,
                event_type="automation_failed" if error else "automation_completed",
                before_state=previous,
                after_state=case.state if case else run.state,
            )
        )


@celery.task(name="shipping.drain")
def drain() -> None:
    job = claim()
    if not job:
        return
    error = None
    try:
        if job.exhausted:
            error = "lease_expired"
        elif job.stage == "receipt":
            error = verify_receipt(job.message_id)
        else:
            with session_factory()() as db:
                db.execute(text("SELECT 1"))
    except Exception:
        error = "worker_dependency_error"
    finish(job, error)
    if error:
        log.warning("automation trace=%s code=%s", job.trace_id, error)
