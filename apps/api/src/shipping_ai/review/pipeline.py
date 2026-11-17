from dataclasses import dataclass
from datetime import date
from time import monotonic
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from shipping_ai.ai.provider import (
    PROMPT_VERSION,
    InvalidAdvisory,
    OllamaProvider,
    ProviderUnavailable,
    review_context,
)
from shipping_ai.ai.translation import choices, propose
from shipping_ai.approvals.review import blockers_for
from shipping_ai.cdc.master import check_cdc, company_key
from shipping_ai.core.config import settings
from shipping_ai.core.db import session_factory
from shipping_ai.documents.extract import extract
from shipping_ai.documents.storage import LocalStorage
from shipping_ai.documents.text_representation import apply_company_aliases
from shipping_ai.investigation.jobs import eligible
from shipping_ai.investigation.schemas import Investigation
from shipping_ai.models import (
    AutomationRun,
    CdcMasterVersion,
    Company,
    Document,
    DocumentExtraction,
    IntakeCase,
    ReviewSnapshot,
)

from .compare import finding, overall, review_documents
from .schemas import Candidate, Extraction, Finding
from .values import source_identity, usable

RULES_VERSION = "2.8"
MAX_ACTIVE_DOCUMENTS = 12
ANALYSIS_BUDGET_SECONDS = 180


@dataclass(frozen=True)
class Analysis:
    extractions: list[Extraction]
    findings: list[Finding]
    candidates: list[Candidate]
    reference: str | None
    master_id: UUID | None
    detected_company_id: UUID | None = None


def enqueue(db, case_id: UUID, revision: int, stage: str = "analysis"):
    event_key = f"{stage}:{case_id}:{revision}"
    run_id = db.scalar(
        insert(AutomationRun)
        .values(event_key=event_key, stage=stage, intake_case_id=case_id, input_revision=revision)
        .on_conflict_do_nothing(index_elements=[AutomationRun.event_key])
        .returning(AutomationRun.id)
    )
    return run_id or db.scalar(select(AutomationRun.id).where(AutomationRun.event_key == event_key))


def registered_master(db, case, invoice: Extraction | None, *, company_id=None):
    if invoice is None or not invoice.items:
        return None, "An extracted invoice with line items is needed to look up a CDC Master List."
    company = company_key(usable(invoice.fields.get("consignee")))
    if not company:
        return None, "Verify the invoice consignee before choosing a CDC Master List."
    invoice_date = usable(invoice.fields.get("invoice_date"))
    try:
        year = date.fromisoformat(invoice_date).year if invoice_date else None
    except ValueError:
        year = None
    if year is None:
        return None, "The invoice date is missing or uncertain. Choose the applicable CDC version."
    query = select(CdcMasterVersion.id).where(
        CdcMasterVersion.workspace_id == case.workspace_id,
        CdcMasterVersion.company_key == company,
        CdcMasterVersion.year == year,
    )
    if assigned := company_id or case.company_id:
        query = query.where(CdcMasterVersion.company_id == assigned)
    matches = db.scalars(query.limit(2)).all()
    if len(matches) == 1:
        return db.get(CdcMasterVersion, matches[0]), None
    if matches:
        return (
            None,
            "Several CDC versions match the invoice company and year. Choose the applicable approval reference and workbook revision.",
        )
    return None, "No verified CDC Master List is registered for the invoice company and year."


def detected_company(db, case, roles):
    if case.company_id or case.channel != "gmail":
        return None
    invoice = roles.get("invoice")
    consignee = source_identity(usable(invoice.fields.get("consignee"))) if invoice else None
    if not consignee:
        return None
    observed = {
        source_identity(usable(doc.fields.get("consignee")))
        for doc in roles.values()
        if usable(doc.fields.get("consignee"))
    }
    matches = []
    for company in db.scalars(select(Company).where(Company.workspace_id == case.workspace_id)):
        names = {
            source_identity(name)
            for name in (company.name, *company.aliases, company.verified_english_name)
            if name
        }
        if consignee in names and observed <= names:
            matches.append(company.id)
    return matches[0] if len(matches) == 1 else None


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

    with session_factory()() as db:
        apply_company_aliases(
            extractions, db.scalars(select(Company).where(Company.workspace_id == case.workspace_id))
        )
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
    lookup_issue = None
    company_id = None
    if master is None and processed == len(active):
        with session_factory()() as db:
            company_id = detected_company(db, case, roles)
            master, lookup_issue = registered_master(db, case, invoice, company_id=company_id)
    if lookup_issue:
        findings.append(finding("cdc", "version", "NEEDS_REVIEW", lookup_issue))
        candidates = []
    else:
        checks, candidates = check_cdc(invoice, master)
        findings.extend(checks)
    reference = usable(invoice.fields.get("invoice_no")) if invoice else None
    if reference and len(reference) > 160:
        reference = None
    return Analysis(
        extractions, findings, candidates, reference, master.id if master else None, company_id
    )


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
    blockers, roles, _ = blockers_for(result.extractions, {})
    document_limit = any(item.field == "document_limit" for item in result.findings)
    if cfg.investigation_enabled and not document_limit:
        if eligible(roles, result.findings):
            investigation_id = enqueue(db, case.id, run.input_revision, "investigation")
            investigation = db.get(AutomationRun, investigation_id)
            investigation.investigation = Investigation(
                model=cfg.ollama_model if cfg.ollama_enabled else None,
            ).model_dump(mode="json")
    if cfg.ollama_enabled:
        if review_context(result.findings) or choices(result.extractions):
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
    if result.detected_company_id and not case.company_id:
        case.company_id = result.detected_company_id
    case.detected_reference = result.reference
    if not blockers and not document_limit:
        case.state = "ready_for_approval"
        case.review_reason = "Required checks passed. Save and confirm the staff review."
    else:
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
        documents = [
            Extraction.model_validate(payload)
            for payload in db.scalars(
                select(DocumentExtraction.payload)
                .where(DocumentExtraction.snapshot_id == snapshot.id)
                .order_by(DocumentExtraction.role, DocumentExtraction.document_id)
            )
        ]
    config = settings().model_copy(update={"ollama_model": snapshot.ai_model})
    provider = OllamaProvider(config)
    requests = choices(documents)
    translations = snapshot.translations
    if requests and (not translations or translations["state"] != "ready"):
        translations = propose(provider, requests)
    context = review_context(findings)
    state, suggestions = "ready", []
    if translations and translations["state"] != "ready":
        state = translations["state"]
    if context and state == "ready":
        try:
            result = provider.advise(context)
            suggestions = [item.model_dump(mode="json") for item in result.suggestions]
        except ProviderUnavailable:
            state = "unavailable"
        except InvalidAdvisory:
            state = "invalid_output"
    return state, suggestions, translations
