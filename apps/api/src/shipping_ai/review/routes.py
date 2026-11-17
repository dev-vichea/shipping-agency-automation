from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from shipping_ai.ai.translation import overlay
from shipping_ai.cdc.master import description_suggestions, matches_master_company
from shipping_ai.cdc.routes import view
from shipping_ai.core.access import access, company_access, master_access, visible_case
from shipping_ai.core.auth import DB, Staff, browser_origin
from shipping_ai.documents.text_representation import field_groups
from shipping_ai.models import (
    ActivityEvent,
    AutomationRun,
    CdcMasterVersion,
    Company,
    DocumentExtraction,
    ReviewSnapshot,
)

from .compare import line_comparisons
from .pipeline import enqueue
from .schemas import Extraction, Finding, ReviewView
from .values import usable

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
    return visible_case(db, case_id, lock=lock)


def queued_run(db, case):
    return db.scalar(
        select(AutomationRun).where(
            AutomationRun.intake_case_id == case.id,
            AutomationRun.input_revision == case.analysis_revision,
            AutomationRun.stage == "analysis",
        )
    )


def english_comparison_master(db, case, invoice):
    """Allow a read-only English name comparison across language copies of one approval."""
    if not case.company_id or not (printed_date := usable(invoice.fields.get("invoice_date"))):
        return None
    try:
        year = date.fromisoformat(printed_date).year
    except ValueError:
        return None
    versions = db.execute(
        select(CdcMasterVersion.id, CdcMasterVersion.approval_ref, CdcMasterVersion.layout)
        .where(CdcMasterVersion.company_id == case.company_id, CdcMasterVersion.year == year, master_access(db))
        .limit(21)
    ).all()
    english = [version.id for version in versions if version.layout in {"english_application", "english_cut_stock"}]
    if len(versions) < 21 and len({version.approval_ref for version in versions}) == len(english) == 1:
        return db.get(CdcMasterVersion, english[0])
    return None


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
    analysis_run = (
        run if run and run.id == snapshot.run_id else db.get(AutomationRun, snapshot.run_id)
    )
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
    documents = [Extraction.model_validate(item.payload) for item in extractions]
    findings = [Finding.model_validate(item) for item in snapshot.findings]
    overlay(documents, snapshot.translations, ai_state=snapshot.ai_state)
    if not access(db).admin:
        visible = set(db.scalars(select(Company.id).where(company_access(db))))
        for document in documents:
            for fields in field_groups(document):
                for candidate in fields.values():
                    if candidate.english and candidate.english.company_id and candidate.english.company_id not in visible:
                        candidate.english = None
    candidates = snapshot.candidates
    invoices = [document for document in documents if document.role == "invoice"]
    invoice = invoices[0] if len(invoices) == 1 and invoices[0].error != "multiple_workbook_sections" else None
    comparison_master = None
    # Translation can arrive after analysis. Re-rank names for review without
    # changing the saved findings, eligibility checks, or staff mappings.
    if analyzed_master:
        visible_master = db.scalar(
            select(CdcMasterVersion.id).where(
                CdcMasterVersion.id == analyzed_master.id, master_access(db)
            )
        )
        if visible_master:
            assigned_master = case.company_id and case.company_id == analyzed_master.company_id
            translated = (snapshot.translations or {}).get("state") == "ready"
            if invoice and (assigned_master or (translated and matches_master_company(invoice, analyzed_master))):
                candidates = description_suggestions(invoice, analyzed_master)
        else:
            analyzed_master, candidates = None, []
    elif invoice and not master and snapshot.revision == case.analysis_revision:
        comparison_master = english_comparison_master(db, case, invoice)
        if comparison_master:
            candidates = description_suggestions(invoice, comparison_master)
    return {
        **output,
        "state": "available" if snapshot.revision == case.analysis_revision else output["state"],
        "analysis_revision": snapshot.revision,
        "trace_id": analysis_run.trace_id if analysis_run else None,
        "outcome": snapshot.outcome,
        "rules_version": snapshot.rules_version,
        "extracted_at": snapshot.created_at,
        "extractions": documents,
        "findings": findings,
        "line_items": line_comparisons(documents, findings),
        "candidates": candidates,
        "analyzed_master": view(analyzed_master),
        "comparison_master": view(comparison_master),
        "ai_state": snapshot.ai_state,
        "ai_model": snapshot.ai_model,
        "ai_prompt_version": snapshot.ai_prompt_version,
        "ai_trace_id": snapshot.ai_trace_id,
        "ai_suggestions": snapshot.ai_suggestions,
        "version_diff": snapshot.version_diff,
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
    if payload.version_id:
        master = db.scalar(
            select(CdcMasterVersion).where(
                CdcMasterVersion.id == payload.version_id, master_access(db)
            )
        )
        if master is None or (case.company_id and case.company_id != master.company_id):
            raise HTTPException(404, "CDC Master List version not found for this company")
    case.cdc_master_version_id = payload.version_id
    return queue_review(db, user, case, "cdc_version_selected")


class CompanySelection(ProcessRequest):
    company_id: UUID


@router.post("/{case_id}/company", status_code=202, dependencies=[Depends(browser_origin)])
def assign_company(case_id: UUID, payload: CompanySelection, db: DB, user: Staff):
    from shipping_ai.core.access import require_workspace, visible_company
    from shipping_ai.models import ImportRecord

    require_workspace(db, admin=True)
    case = get_case(db, case_id, lock=True)
    company = visible_company(db, payload.company_id)
    if payload.expected_revision != case.analysis_revision:
        raise HTTPException(409, "This intake changed. Refresh before assigning its company.")
    if case.company_id == company.id:
        return {"revision": case.analysis_revision}
    if (
        case.company_id
        or case.state in {"approved", "rejected"}
        or db.scalar(select(ImportRecord.id).where(ImportRecord.intake_case_id == case.id))
    ):
        raise HTTPException(
            409, "Only unassigned intakes without an import record can be assigned."
        )
    case.company_id = company.id
    case.cdc_master_version_id = None
    return queue_review(db, user, case, "company_assigned")
