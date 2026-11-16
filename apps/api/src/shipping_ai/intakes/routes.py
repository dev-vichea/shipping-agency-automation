import hashlib
import json
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import ValidationError
from sqlalchemy import column, func, or_, select, true
from sqlalchemy.dialects.postgresql import JSONB, insert
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from shipping_ai.core.access import (
    access,
    case_access,
    require_workspace,
    visible_case,
    visible_company,
)
from shipping_ai.core.auth import DB, Staff, browser_origin
from shipping_ai.core.config import settings
from shipping_ai.documents.storage import InvalidUpload, LocalStorage, StoredFile
from shipping_ai.models import (
    ActivityEvent,
    AutomationRun,
    Company,
    Document,
    DocumentExtraction,
    ImportRecord,
    IncomingMessage,
    IntakeCase,
    ReviewSnapshot,
    User,
)

from .schemas import Arrival, CaseDetail, CaseSummary, Receipt

router = APIRouter(prefix="/intakes", tags=["intakes"])
CHANNEL = "simulated"
PageSize = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100_000)]


@router.get("", response_model=list[CaseSummary])
def list_cases(
    db: DB,
    _user: Staff,
    limit: PageSize = 30,
    offset: Offset = 0,
    q: Annotated[str | None, Query(max_length=160)] = None,
    outcome: Literal["PASS", "WARNING", "MISMATCH", "NEEDS_REVIEW"] | None = None,
    state: Literal["queued", "needs_review", "ready_for_approval", "approved", "rejected", "failed"]
    | None = None,
    include_checks: bool = False,
    company_id: UUID | None = None,
    oldest_first: bool = False,
    queue: Literal["approval", "draft"] | None = None,
    run_state: Literal["running"] | None = None,
    source: Literal["manual", "gmail", "folder"] | None = None,
):
    counts = (
        select(func.count(Document.id))
        .where(Document.intake_case_id == IntakeCase.id)
        .correlate(IntakeCase)
        .scalar_subquery()
    )
    latest_message = (
        select(IncomingMessage.subject, IncomingMessage.sender, IncomingMessage.received_at)
        .where(IncomingMessage.intake_case_id == IntakeCase.id)
        .order_by(IncomingMessage.received_at.desc(), IncomingMessage.id.desc())
        .limit(1)
        .correlate(IntakeCase)
        .lateral()
    )
    query = (
        select(
            IntakeCase,
            counts,
            latest_message.c.subject,
            latest_message.c.sender,
            latest_message.c.received_at,
            ReviewSnapshot.outcome,
            Company.name,
        )
        .select_from(IntakeCase)
        .outerjoin_from(IntakeCase, latest_message, true())
        .outerjoin(Company, Company.id == IntakeCase.company_id)
        .where(case_access(db))
        .outerjoin(
            ReviewSnapshot,
            (ReviewSnapshot.intake_case_id == IntakeCase.id)
            & (ReviewSnapshot.revision == IntakeCase.analysis_revision),
        )
    )
    if company_id:
        visible_company(db, company_id)
        query = query.where(IntakeCase.company_id == company_id)
    if outcome:
        query = query.where(ReviewSnapshot.outcome == outcome)
    if state:
        query = query.where(IntakeCase.state == state)
    if source:
        query = query.where(IntakeCase.channel == source)
    if queue == "approval":
        query = query.where(IntakeCase.state.in_(("needs_review", "ready_for_approval")))
    if queue == "draft":
        query = query.where(
            ReviewSnapshot.id.is_not(None),
            IntakeCase.state.in_(("needs_review", "ready_for_approval")),
        )
    running = (
        select(AutomationRun.id)
        .where(
            AutomationRun.intake_case_id == IntakeCase.id,
            AutomationRun.input_revision == IntakeCase.analysis_revision,
            AutomationRun.state == "running",
        )
        .correlate(IntakeCase)
        .exists()
    )
    query = query.add_columns(running)
    if run_state:
        query = query.where(IntakeCase.state == "queued", running)
    if q and q.strip():
        term = q.strip()
        extraction = DocumentExtraction.payload
        lines = func.jsonb_array_elements(extraction["items"]).table_valued(column("value", JSONB))
        matching_code = (
            select(1)
            .select_from(lines)
            .where(
                lines.c.value["fields"]["hs_code"]["value"].astext.icontains(term, autoescape=True)
            )
            .correlate(DocumentExtraction)
            .exists()
        )
        matching_extraction = (
            select(1)
            .where(
                DocumentExtraction.snapshot_id == ReviewSnapshot.id,
                or_(
                    *(
                        extraction["fields"][key]["value"].astext.icontains(term, autoescape=True)
                        for key in ("bl_no", "container", "vessel", "voyage")
                    ),
                    matching_code,
                ),
            )
            .correlate(ReviewSnapshot)
            .exists()
        )
        query = query.where(
            or_(
                Company.name.icontains(term, autoescape=True),
                IntakeCase.detected_reference.icontains(term, autoescape=True),
                latest_message.c.subject.icontains(term, autoescape=True),
                latest_message.c.sender.icontains(term, autoescape=True),
                matching_extraction,
            )
        )
    if include_checks:
        bill = (
            select(DocumentExtraction.payload["fields"]["bl_no"]["value"].astext)
            .where(
                DocumentExtraction.snapshot_id == ReviewSnapshot.id,
                DocumentExtraction.role == "draft_bl",
            )
            .order_by(DocumentExtraction.document_id)
            .limit(1)
            .correlate(ReviewSnapshot)
            .scalar_subquery()
        )
        roles = (
            select(func.array_agg(func.distinct(DocumentExtraction.role)))
            .where(
                DocumentExtraction.snapshot_id == ReviewSnapshot.id,
                DocumentExtraction.status.in_(("extracted", "partial")),
            )
            .correlate(ReviewSnapshot)
            .scalar_subquery()
        )
        query = query.add_columns(ReviewSnapshot.findings, roles, bill)
    rows = db.execute(
        query.order_by(
            IntakeCase.created_at.asc() if oldest_first else IntakeCase.created_at.desc(),
            IntakeCase.id,
        )
        .offset(offset)
        .limit(limit)
    )
    output = []
    priority = {"PASS": 0, "WARNING": 1, "NEEDS_REVIEW": 2, "MISMATCH": 3}
    for case, count, title, sender, received, result, company, processing, *checks in rows:
        item = {
            **summary(case, count, title, company),
            "sender": sender,
            "received_at": received,
            "analysis_outcome": result,
        }
        if processing and case.state == "queued":
            item["state"] = "processing"
        if checks:
            findings, roles, bill = checks
            statuses = {}
            for finding in findings or []:
                group, status = finding["group"], finding["outcome"]
                if group not in statuses or priority[status] > priority[statuses[group]]:
                    statuses[group] = status
            item.update(
                bill_of_lading=bill,
                review_checks=statuses,
                document_roles=roles or [],
                issue_count=sum(finding["outcome"] != "PASS" for finding in findings or []),
            )
        output.append(item)
    return output


def summary(case: IntakeCase, count: int, subject: str | None, company: str | None = None) -> dict:
    return {
        "id": case.id,
        "state": case.state,
        "channel": case.channel,
        "company_id": case.company_id,
        "company": company,
        "detected_reference": case.detected_reference,
        "review_reason": case.review_reason,
        "created_at": case.created_at,
        "updated_at": case.updated_at,
        "attachment_count": count,
        "subject": subject,
    }


@router.get("/{case_id}", response_model=CaseDetail)
def case_detail(case_id: UUID, db: DB, _user: Staff):
    case = visible_case(db, case_id)
    company = db.get(Company, case.company_id) if case.company_id else None
    messages = db.scalars(
        select(IncomingMessage)
        .where(IncomingMessage.intake_case_id == case_id)
        .order_by(IncomingMessage.received_at.desc(), IncomingMessage.id.desc())
    ).all()
    documents = db.scalars(
        select(Document)
        .where(Document.intake_case_id == case_id)
        .order_by(Document.received_at.desc(), Document.id.desc())
    ).all()
    import_id = db.scalar(select(ImportRecord.id).where(ImportRecord.intake_case_id == case_id))
    processing = (
        case.state == "queued"
        and db.scalar(
            select(AutomationRun.id)
            .where(
                AutomationRun.intake_case_id == case.id,
                AutomationRun.input_revision == case.analysis_revision,
                AutomationRun.state == "running",
            )
            .limit(1)
        )
        is not None
    )
    return {
        **summary(
            case,
            len(documents),
            messages[0].subject if messages else None,
            company.name if company else None,
        ),
        "state": "processing" if processing else case.state,
        "received_at": messages[0].received_at if messages else None,
        "messages": messages,
        "documents": documents,
        "import_id": import_id,
    }


@router.post(
    "/simulate",
    status_code=201,
    response_model=Receipt,
    dependencies=[Depends(browser_origin)],
    responses={200: {"model": Receipt}, 409: {"description": "Conflicting replay"}},
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "properties": {
                            **Arrival.model_json_schema()["properties"],
                            "files": {
                                "type": "array",
                                "items": {"type": "string", "format": "binary"},
                            },
                        },
                    }
                },
            },
        }
    },
)
async def simulate(request: Request, response: Response, db: DB, user: Staff):
    cfg = settings()
    if cfg.environment not in {"development", "test"}:
        raise HTTPException(404, "Endpoint not available")
    return await receive(request, response, db, user, CHANNEL)


@router.post(
    "/upload", status_code=201, response_model=Receipt, dependencies=[Depends(browser_origin)]
)
async def upload(request: Request, response: Response, db: DB, user: Staff):
    return await receive(request, response, db, user, "manual")


async def receive(request: Request, response: Response, db: DB, user: User, channel: str):
    cfg = settings()
    require_workspace(db)
    if (
        request.headers.get("content-type", "").split(";")[0].strip().lower()
        != "multipart/form-data"
    ):
        raise HTTPException(415, "Use multipart/form-data")

    async with request.form(max_files=cfg.max_files, max_fields=9, max_part_size=64 * 1024) as form:
        uploads = form.getlist("files")
        fields = [(name, value) for name, value in form.multi_items() if name != "files"]
        if (
            any(not isinstance(value, str) for _, value in fields)
            or any(not isinstance(file, UploadFile) for file in uploads)
            or len(dict(fields)) != len(fields)
        ):
            raise HTTPException(422, "Invalid or repeated form fields")
        try:
            arrival = Arrival.model_validate(dict(fields))
        except ValidationError:
            raise HTTPException(422, "Invalid arrival metadata") from None
        if channel == "manual" and not arrival.intake_case_id and not uploads:
            raise HTTPException(422, "Attach at least one document")
        if not uploads and not (arrival.subject or (arrival.body and arrival.body.strip())):
            raise HTTPException(422, "Provide a subject, message or attachment")
        if arrival.parent_version_id and (not arrival.intake_case_id or len(uploads) != 1):
            raise HTTPException(422, "A revision requires one file and its existing intake")

        if arrival.intake_case_id:
            await run_in_threadpool(visible_case, db, arrival.intake_case_id)
        elif arrival.company_id:
            await run_in_threadpool(visible_company, db, arrival.company_id)
        elif not access(db).admin:
            raise HTTPException(422, "Select an assigned company")
        store = LocalStorage(cfg.storage_dir)
        files: dict[str, StoredFile] = {}
        for upload in uploads:
            try:
                stored = await run_in_threadpool(
                    store.store,
                    upload.file,
                    upload.filename or "",
                    upload.content_type or "",
                    cfg.max_file_bytes,
                )
            except InvalidUpload as exc:
                raise HTTPException(exc.status, str(exc)) from None
            previous = files.get(stored.sha256)
            if previous is None or stored.name < previous.name:
                files[stored.sha256] = stored
        receipt = await run_in_threadpool(archive_arrival, db, user, arrival, files, channel)
        if receipt.replayed:
            response.status_code = 200
        return receipt


def archive_arrival(
    db: DB,
    user: User,
    arrival: Arrival,
    files: dict[str, StoredFile],
    channel: str = CHANNEL,
    *,
    received_at: datetime | None = None,
) -> Receipt:
    workspace = require_workspace(db)
    provider_id = arrival.provider_message_id or str(uuid4())
    fingerprint = hashlib.sha256(
        json.dumps(
            [
                arrival.model_dump(mode="json"),
                sorted((file.sha256, file.name) for file in files.values()),
            ],
            sort_keys=True,
            ensure_ascii=True,
        ).encode()
    ).hexdigest()

    if arrival.intake_case_id:
        case = visible_case(db, arrival.intake_case_id, lock=True)
        if arrival.company_id and arrival.company_id != case.company_id:
            raise HTTPException(422, "Use the company assigned to this intake")
    else:
        if arrival.company_id:
            visible_company(db, arrival.company_id)
        case = IntakeCase(channel=channel, workspace_id=workspace, company_id=arrival.company_id)
        db.add(case)
        db.flush()

    if arrival.parent_version_id:
        parent = db.get(Document, arrival.parent_version_id)
        if not parent or parent.intake_case_id != case.id:
            raise HTTPException(422, "Parent document must belong to the same intake")
        if parent.sha256 in files:
            raise HTTPException(422, "A revision must contain different file bytes")

    message_id = db.scalar(
        insert(IncomingMessage)
        .values(
            intake_case_id=case.id,
            channel=channel,
            workspace_id=workspace,
            provider_message_id=provider_id,
            sender=arrival.sender,
            subject=arrival.subject,
            body=arrival.body,
            thread_id=arrival.thread_id,
            payload_hash=fingerprint,
            **({"received_at": received_at} if received_at else {}),
        )
        .on_conflict_do_nothing(index_elements=["workspace_id", "channel", "provider_message_id"])
        .returning(IncomingMessage.id)
    )
    if message_id is None:
        db.rollback()
        existing = db.scalar(
            select(IncomingMessage)
            .join(IntakeCase)
            .where(
                case_access(db),
                IncomingMessage.workspace_id == workspace,
                IncomingMessage.channel == channel,
                IncomingMessage.provider_message_id == provider_id,
            )
        )
        if existing is None or existing.payload_hash != fingerprint:
            raise HTTPException(
                409, "This message ID has already been archived with different content"
            )
        run_id = db.scalar(
            select(AutomationRun.id).where(AutomationRun.event_key == f"receipt:{existing.id}")
        )
        return Receipt(case_id=existing.intake_case_id, run_id=run_id, replayed=True)

    previous = case.state
    case.state = "queued"
    case.analysis_revision += 1
    case.detected_reference = None
    case.review_reason = None
    db.add_all(
        [
            Document(
                intake_case_id=case.id,
                source_message_id=message_id,
                parent_version_id=arrival.parent_version_id,
                original_filename=file.name,
                classification=arrival.classification,
                mime=file.mime,
                sha256=file.sha256,
                storage_key=file.sha256,
                size_bytes=file.size,
            )
            for file in files.values()
        ]
    )
    run = AutomationRun(
        event_key=f"receipt:{message_id}",
        stage="receipt",
        workspace_id=workspace,
        input_revision=case.analysis_revision,
        message_id=message_id,
        intake_case_id=case.id,
    )
    db.add(run)
    db.flush()
    db.add(
        ActivityEvent(
            actor_type="staff",
            actor_id=user.id,
            intake_case_id=case.id,
            automation_run_id=run.id,
            event_type="arrival_archived",
            before_state=previous if arrival.intake_case_id else None,
            after_state="queued",
        )
    )
    db.commit()
    return Receipt(case_id=case.id, run_id=run.id, replayed=False)


@router.get("/{case_id}/activity")
def activity(case_id: UUID, db: DB, _user: Staff):
    visible_case(db, case_id)
    rows = db.execute(
        select(
            ActivityEvent.id,
            ActivityEvent.event_type,
            ActivityEvent.actor_type,
            ActivityEvent.created_at,
            ActivityEvent.before_state,
            ActivityEvent.after_state,
            ActivityEvent.automation_run_id,
            User.email.label("actor"),
        )
        .outerjoin(User, ActivityEvent.actor_id == User.id)
        .where(ActivityEvent.intake_case_id == case_id)
        .order_by(ActivityEvent.created_at.desc(), ActivityEvent.id.desc())
        .limit(100)
    )
    return [dict(row._mapping) for row in rows]
