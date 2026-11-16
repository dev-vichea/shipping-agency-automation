"""Load a single analysis revision and persist attempt-fenced checkpoints."""

from datetime import UTC, datetime

from sqlalchemy import select, update

from shipping_ai.ai.provider import OllamaProvider
from shipping_ai.core.config import settings
from shipping_ai.core.db import session_factory
from shipping_ai.documents.storage import LocalStorage
from shipping_ai.models import (
    AutomationRun,
    Document,
    DocumentExtraction,
    IntakeCase,
    ReviewSnapshot,
)
from shipping_ai.review.schemas import Extraction
from shipping_ai.review.values import usable

from .loop import Sources, run_loop
from .schemas import Investigation, Source, ToolSelection


def eligible(roles, findings):
    packing = roles.get("packing_list")
    packing_count = packing.fields.get("packages") if packing else None
    if not usable(packing_count) or packing_count.unit != "PKG":
        return False
    bill = roles.get("draft_bl")
    if not bill:
        return False
    if not usable(bill.fields.get("packages")):
        return True
    return any(
        finding.key == "transport.packages.packing_list" and finding.outcome != "PASS"
        for finding in findings
    )


def load_source(db, snapshot, role):
    row = db.execute(
        select(DocumentExtraction, Document)
        .join(Document, Document.id == DocumentExtraction.document_id)
        .where(
            DocumentExtraction.snapshot_id == snapshot.id,
            DocumentExtraction.role == role,
            Document.intake_case_id == snapshot.intake_case_id,
            Document.is_generated.is_(False),
        )
    ).one_or_none()
    if not row:
        return None, None
    record, document = row
    extraction = Extraction.model_validate(record.payload)
    source = Source(
        document_id=document.id,
        sha256=document.sha256,
        parent_version_id=document.parent_version_id,
        method=extraction.method,
        extracted=extraction.fields.get("packages") or {},
    )
    return source, document


def snapshot_for(db, case_id, revision):
    return db.scalar(select(ReviewSnapshot).filter_by(intake_case_id=case_id, revision=revision))


def checkpoint(job, state: Investigation) -> bool:
    with session_factory().begin() as db:
        statement = (
            update(AutomationRun)
            .where(
                AutomationRun.id == job.id,
                AutomationRun.state == "running",
                AutomationRun.attempt == job.attempt,
                AutomationRun.lease_until > datetime.now(UTC),
                select(IntakeCase.id)
                .where(
                    IntakeCase.id == job.case_id,
                    IntakeCase.analysis_revision == job.revision,
                )
                .exists(),
            )
            .values(investigation=state.model_dump(mode="json"))
            .returning(AutomationRun.id)
        )
        return db.scalar(statement) is not None


def investigate(job):
    cfg = settings()
    with session_factory()() as db:
        run = db.get(AutomationRun, job.id)
        if not run or run.state != "running" or run.attempt != job.attempt:
            return None
        case = db.get(IntakeCase, job.case_id)
        if not case or case.analysis_revision != job.revision:
            return None
        snapshot = snapshot_for(db, case.id, job.revision)
        if snapshot is None:
            return None
        state = Investigation.model_validate(run.investigation)
        packing, _ = load_source(db, snapshot, "packing_list")
        bill, document = load_source(db, snapshot, "draft_bl")
    state.reason = None
    sources = Sources(packing, bill, document, LocalStorage(cfg.storage_dir))
    plan = None
    if state.model:
        provider = OllamaProvider(cfg.model_copy(update={"ollama_model": state.model}))

        def plan(context, deadline):
            return provider.choose_tool(context, deadline, ToolSelection)

    return run_loop(state, sources, job.attempt, lambda state: checkpoint(job, state), plan)


def finish_investigation(run, result, *, current, retrying):
    state = result or Investigation.model_validate(run.investigation)
    if not current:
        state = state.model_copy(
            update={"status": "superseded", "reason": "revision_superseded", "proposal": None}
        )
    elif retrying:
        state.status = "pending"
    elif not result:
        state.status = "needs_review"
        state.reason = "worker_retries_exhausted"
    run.investigation = state.model_dump(mode="json")
