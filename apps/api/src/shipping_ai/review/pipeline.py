from dataclasses import dataclass
from time import monotonic
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from shipping_ai.ai.provider import (
    PROMPT_VERSION,
    InvalidAdvisory,
    ModelProvider,
    OllamaProvider,
    ProviderUnavailable,
    review_context,
)
from shipping_ai.cdc.master import check_cdc
from shipping_ai.core.config import settings
from shipping_ai.core.db import session_factory
from shipping_ai.documents.extract import extract
from shipping_ai.documents.storage import LocalStorage
from shipping_ai.models import (
    AutomationRun,
    CdcMasterVersion,
    Document,
    DocumentExtraction,
    IntakeCase,
    ReviewSnapshot,
)

from .compare import finding, overall, review_documents
from .schemas import Candidate, Extraction, Finding
from .values import usable

RULES_VERSION = "2.0"
MAX_ACTIVE_DOCUMENTS = 12
ANALYSIS_BUDGET_SECONDS = 180


@dataclass(frozen=True)
class Analysis:
    extractions: list[Extraction]
    findings: list[Finding]
    candidates: list[Candidate]
    reference: str | None
    master_id: UUID | None


def enqueue(db, case_id: UUID, revision: int, stage: str = "analysis"):
    event_key = f"{stage}:{case_id}:{revision}"
    run_id = db.scalar(
        insert(AutomationRun)
        .values(event_key=event_key, stage=stage, intake_case_id=case_id, input_revision=revision)
        .on_conflict_do_nothing(index_elements=[AutomationRun.event_key])
        .returning(AutomationRun.id)
    )
    return run_id or db.scalar(select(AutomationRun.id).where(AutomationRun.event_key == event_key))


def read_analysis(case_id: UUID, revision: int) -> Analysis | None:
    with session_factory()() as db:
        case = db.get(IntakeCase, case_id)
        if case is None or case.analysis_revision != revision:
            return None
        docs = db.scalars(
            select(Document)
            .where(
                Document.intake_case_id == case_id,
                Document.is_generated.is_(False),
            )
            .order_by(Document.received_at.desc(), Document.id.desc())
        ).all()
        master = (
            db.get(CdcMasterVersion, case.cdc_master_version_id)
            if case.cdc_master_version_id
            else None
        )
    superseded = {doc.parent_version_id for doc in docs if doc.parent_version_id}
    seen = set()
    active = []
    for doc in docs:
        if doc.id not in superseded and doc.sha256 not in seen:
            active.append(doc)
            seen.add(doc.sha256)

    originals = LocalStorage(settings().storage_dir)
    extractions = []
    deadline = monotonic() + ANALYSIS_BUDGET_SECONDS
    processed = 0
    for doc in active[:MAX_ACTIVE_DOCUMENTS]:
        if monotonic() >= deadline:
            break
        try:
            if not originals.verify(doc.storage_key, doc.size_bytes):
                raise ArchiveUnavailable("attachment_checksum_mismatch")
            data = originals.path(doc.storage_key).read_bytes()
        except FileNotFoundError:
            raise ArchiveUnavailable("attachment_unavailable") from None
        extractions.extend(extract(data, doc.original_filename, doc.id, doc.classification))
        processed += 1

    findings, roles = review_documents(extractions)
    if processed < len(active):
        findings.append(
            finding(
                "extraction",
                "document_limit",
                "NEEDS_REVIEW",
                "Analysis reached its document or time limit. Inspect originals without an extraction.",
            )
        )
    invoice = roles.get("invoice")
    checks, candidates = check_cdc(invoice, master)
    findings.extend(checks)
    reference = usable(invoice.fields.get("invoice_no")) if invoice else None
    if reference and len(reference) > 160:
        reference = None
    return Analysis(extractions, findings, candidates, reference, master.id if master else None)


class ArchiveUnavailable(Exception):
    pass


def save_analysis(db, run: AutomationRun, case: IntakeCase, result: Analysis) -> None:
    snapshot = ReviewSnapshot(
        intake_case_id=case.id,
        revision=run.input_revision,
        run_id=run.id,
        cdc_master_version_id=result.master_id,
        rules_version=RULES_VERSION,
        outcome=overall(result.findings),
        findings=[item.model_dump(mode="json") for item in result.findings],
        candidates=[item.model_dump(mode="json") for item in result.candidates],
        ai_state="disabled",
    )
    cfg = settings()
    if cfg.ollama_enabled:
        if review_context(result.findings):
            ai_id = enqueue(db, case.id, run.input_revision, "ai")
            snapshot.ai_state = "pending"
            snapshot.ai_model = cfg.ollama_model
            snapshot.ai_prompt_version = PROMPT_VERSION
            snapshot.ai_trace_id = db.get(AutomationRun, ai_id).trace_id
        else:
            snapshot.ai_state = "not_needed"
    db.add(snapshot)
    db.flush()
    db.add_all(
        [
            DocumentExtraction(
                snapshot_id=snapshot.id,
                document_id=doc.document_id,
                role=doc.role,
                status=doc.status,
                payload=doc.model_dump(mode="json"),
            )
            for doc in result.extractions
        ]
    )
    case.detected_reference = result.reference
    case.state = "needs_review"
    case.review_reason = "Document findings are ready for staff review."


def advisory(case_id: UUID, revision: int):
    with session_factory()() as db:
        case = db.get(IntakeCase, case_id)
        if case is None or case.analysis_revision != revision:
            return None
        snapshot = db.scalar(
            select(ReviewSnapshot).filter_by(intake_case_id=case_id, revision=revision)
        )
        if snapshot is None:
            return None
        findings = [Finding.model_validate(item) for item in snapshot.findings]
    try:
        config = settings().model_copy(update={"ollama_model": snapshot.ai_model})
        provider: ModelProvider = OllamaProvider(config)
        result = provider.advise(review_context(findings))
    except ProviderUnavailable:
        return "unavailable", []
    except InvalidAdvisory:
        return "invalid_output", []
    return "ready", [item.model_dump(mode="json") for item in result.suggestions]
