from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from celery import Celery
from celery.utils.log import get_task_logger
from sqlalchemy import and_, or_, select, text

from shipping_ai.core.config import settings
from shipping_ai.core.db import session_factory
from shipping_ai.documents.storage import LocalStorage
from shipping_ai.integrations.gmail import sync_all
from shipping_ai.investigation.jobs import finish_investigation, investigate
from shipping_ai.models import ActivityEvent, AutomationRun, Document, IntakeCase, ReviewSnapshot
from shipping_ai.review.pipeline import (
    ArchiveUnavailable,
    advisory,
    enqueue,
    read_analysis,
    save_analysis,
)

MAX_RETRIES = 3
LEASE = timedelta(minutes=5)
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
        },
        "sync-authorized-gmail": {
            "task": "shipping.sync_gmail",
            "schedule": 60.0,
            "options": {"expires": 55},
        },
        "sync-telegram-updates": {
            "task": "shipping.sync_telegram",
            "schedule": 5.0,
            "options": {"expires": 8},
        },
    },
)


@dataclass(frozen=True)
class Claim:
    id: UUID
    attempt: int
    stage: str
    message_id: UUID | None
    trace_id: UUID
    case_id: UUID | None
    revision: int | None
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
        return Claim(
            run.id,
            run.attempt,
            run.stage,
            run.message_id,
            run.trace_id,
            run.intake_case_id,
            run.input_revision,
            exhausted,
        )


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


def finish(job: Claim, error: str | None, result=None) -> None:
    now = datetime.now(UTC)
    with session_factory().begin() as db:
        # Lock the case before its run, matching staff reprocess and version selection.
        case = db.get(IntakeCase, job.case_id, with_for_update=True) if job.case_id else None
        run = db.get(AutomationRun, job.id, with_for_update=True)
        if not run or run.state != "running" or run.attempt != job.attempt:
            return
        if job.stage == "investigation" and run.lease_until <= now:
            return

        current = case is not None and job.revision == case.analysis_revision
        run.error_code = error
        run.lease_until = None
        retrying = (
            error and (not case or current) and run.retry_count < MAX_RETRIES and not job.exhausted
        )
        if job.stage == "investigation":
            finish_investigation(run, result, current=current, retrying=retrying)
        if retrying:
            run.retry_count += 1
            run.available_at = now + timedelta(seconds=5 * 2 ** (run.retry_count - 1))
            run.state = "queued"
            if case and job.stage == "ai":
                snapshot = db.scalar(
                    select(ReviewSnapshot).filter_by(
                        intake_case_id=case.id,
                        revision=job.revision,
                    )
                )
                if snapshot:
                    snapshot.ai_state = result[0] if result else "unavailable"
                    if result and result[2] is not None:
                        snapshot.translations = result[2]
            return
        run.ended_at = now
        run.state = "failed" if error else "succeeded"

        previous = case.state if case else None
        if current:
            if error and job.stage not in {"ai", "investigation"}:
                case.state = "failed"
                case.review_reason = "Document processing failed. See Automation to retry."
            elif job.stage == "receipt":
                enqueue(db, case.id, case.analysis_revision)
            elif job.stage == "analysis" and result is not None:
                save_analysis(db, run, case, result)
                if current:
                    from shipping_ai.integrations.telegram import notify_case_status

                    try:
                        if result.version_diff and result.version_diff.get("has_revisions"):
                            event_type = "revision_received"
                        elif run.input_revision == 1:
                            event_type = "manual_matching" if case.state == "manual_matching" else "new_intake"
                        else:
                            event_type = None

                        if event_type:
                            notify_case_status(
                                db,
                                case,
                                event_type=event_type,
                                details={"version_diff": result.version_diff},
                            )
                    except Exception as exc:
                        log.warning("Telegram status notification error on analysis: %s", exc)
            elif job.stage == "ai":
                snapshot = db.scalar(
                    select(ReviewSnapshot).filter_by(
                        intake_case_id=case.id,
                        revision=job.revision,
                    )
                )
                if snapshot:
                    snapshot.ai_state, snapshot.ai_suggestions = result[:2] if result else ("unavailable", [])
                    if result and result[2] is not None:
                        snapshot.translations = result[2]

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
    result = None
    try:
        if job.exhausted:
            error = "lease_expired"
        elif job.stage == "receipt":
            error = verify_receipt(job.message_id)
        elif job.stage == "analysis":
            result = read_analysis(job.case_id, job.revision)
        elif job.stage == "ai":
            result = advisory(job.case_id, job.revision)
            if result and result[0] != "ready":
                error = f"ollama_{result[0]}"
        elif job.stage == "investigation":
            result = investigate(job)
            if result and result.reason == "model_unavailable":
                error = "ollama_unavailable"
        else:
            with session_factory()() as db:
                db.execute(text("SELECT 1"))
    except ArchiveUnavailable as exc:
        error = str(exc)
    except Exception:
        error = "worker_dependency_error"
    finish(job, error, result)
    if error:
        log.warning("automation trace=%s code=%s", job.trace_id, error)


@celery.task(name="shipping.sync_gmail")
def sync_gmail() -> None:
    sync_all()


@celery.task(name="shipping.sync_telegram")
def sync_telegram() -> None:
    token = settings().telegram_bot_token
    if not token or not token.get_secret_value():
        return
    try:
        from redis import Redis

        from shipping_ai.integrations import telegram

        redis = Redis.from_url(str(settings().redis_url), socket_timeout=2)
        with session_factory().begin() as db:
            telegram.sync_updates(db, redis)
    except Exception as exc:
        log.exception("telegram_sync_error: %s", exc)
