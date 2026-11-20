import hashlib
import json
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import case, column, func, or_, select, true
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
from shipping_ai.intakes.matching import (
    ExtractedIdentifiers,
    detect_document_relationship,
    extract_context_identifiers,
    extract_file_identifiers,
    match_shipment,
)
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
from shipping_ai.review.pipeline import enqueue

from .schemas import Arrival, CaseDetail, CaseSummary, Receipt

router = APIRouter(prefix="/intakes", tags=["intakes"])
CHANNEL = "simulated"
mutation = [Depends(browser_origin)]


class MatchShipment(BaseModel):
    target_case_id: UUID | None = None
    notes: str | None = None
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
    queue: Literal["approval", "draft", "imports"] | None = None,
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
    if queue in ("draft", "imports"):
        query = query.where(
            IntakeCase.state.in_(("needs_review", "ready_for_approval", "approved")),
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
        file_types_sub = (
            select(func.array_agg(
                case(
                    (Document.mime.ilike("%pdf%") | Document.original_filename.ilike("%.pdf"), "pdf"),
                    (
                        Document.mime.ilike("%excel%")
                        | Document.mime.ilike("%spreadsheet%")
                        | Document.mime.ilike("%sheet%")
                        | Document.mime.ilike("%csv%")
                        | Document.original_filename.ilike("%.xlsx")
                        | Document.original_filename.ilike("%.xls")
                        | Document.original_filename.ilike("%.csv"),
                        "excel",
                    ),
                    (
                        Document.mime.ilike("%image%")
                        | Document.original_filename.ilike("%.png")
                        | Document.original_filename.ilike("%.jpg")
                        | Document.original_filename.ilike("%.jpeg")
                        | Document.original_filename.ilike("%.webp"),
                        "image",
                    ),
                    else_="other",
                )
            ))
            .where(Document.intake_case_id == IntakeCase.id)
            .correlate(IntakeCase)
            .scalar_subquery()
        )
        query = query.add_columns(ReviewSnapshot.findings, roles, bill, file_types_sub)
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
    for case_item, count, title, sender, received, result, company, processing, *checks in rows:
        item = {
            **summary(case_item, count, title, company),
            "sender": sender,
            "received_at": received,
            "analysis_outcome": result,
        }
        if processing and case_item.state == "queued":
            item["state"] = "processing"
        if checks:
            findings, roles, bill, *ft_opt = checks
            file_types = ft_opt[0] if ft_opt else []
            statuses = {}
            for finding in findings or []:
                group, status = finding["group"], finding["outcome"]
                if group not in statuses or priority[status] > priority[statuses[group]]:
                    statuses[group] = status
            item.update(
                bill_of_lading=bill,
                review_checks=statuses,
                document_roles=roles or [],
                file_types=file_types or [],
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
        "final_bl_confirmed_revision": case.final_bl_confirmed_revision,
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

    # Extract identifiers from stored files and incoming message
    store = LocalStorage(settings().storage_dir)
    file_idents_map: dict[str, ExtractedIdentifiers] = {}
    combined_idents = extract_context_identifiers(arrival.subject, arrival.body, arrival.thread_id)

    for file in files.values():
        try:
            f_path = store.path(file.sha256)
            if f_path.exists():
                data = f_path.read_bytes()
                f_idents = extract_file_identifiers(data, file.name)
                file_idents_map[file.sha256] = f_idents
                combined_idents.invoice_refs.update(f_idents.invoice_refs)
                combined_idents.bl_numbers.update(f_idents.bl_numbers)
                combined_idents.booking_numbers.update(f_idents.booking_numbers)
                combined_idents.container_numbers.update(f_idents.container_numbers)
                combined_idents.seal_numbers.update(f_idents.seal_numbers)
                if not combined_idents.shipper and f_idents.shipper:
                    combined_idents.shipper = f_idents.shipper
                if not combined_idents.consignee and f_idents.consignee:
                    combined_idents.consignee = f_idents.consignee
                if not combined_idents.vessel and f_idents.vessel:
                    combined_idents.vessel = f_idents.vessel
                if not combined_idents.port and f_idents.port:
                    combined_idents.port = f_idents.port
                if f_idents.gross_weight is not None:
                    combined_idents.gross_weight = f_idents.gross_weight
                if f_idents.packages is not None:
                    combined_idents.packages = f_idents.packages
                if f_idents.is_final_bl:
                    combined_idents.is_final_bl = True
                if f_idents.has_invoice_doc:
                    combined_idents.has_invoice_doc = True
                if f_idents.has_transport_doc:
                    combined_idents.has_transport_doc = True
        except Exception:
            pass

    if arrival.intake_case_id:
        case = visible_case(db, arrival.intake_case_id, lock=True)
        if arrival.company_id and arrival.company_id != case.company_id:
            raise HTTPException(422, "Use the company assigned to this intake")
    else:
        # Multi-identifier matching across active shipments
        decision = match_shipment(
            db, workspace, combined_idents, arrival.thread_id, arrival.company_id
        )
        if decision.status == "matched" and decision.case_id:
            arrival.intake_case_id = decision.case_id
            case = visible_case(db, decision.case_id, lock=True)
        elif decision.status == "uncertain":
            # Requirement 12: send the document to manual matching instead of creating/modifying automatically
            case = IntakeCase(
                channel=channel,
                workspace_id=workspace,
                company_id=arrival.company_id,
                state="manual_matching",
                review_reason=decision.reason,
            )
            db.add(case)
            db.flush()
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

    # Detect document version relationships (duplicate, revision, final BL, new)
    doc_entries = []
    has_non_duplicate = False

    for file in files.values():
        f_ident = file_idents_map.get(file.sha256, ExtractedIdentifiers())
        if arrival.parent_version_id:
            parent_id = arrival.parent_version_id
            parent_doc = db.get(Document, parent_id)
            ver_num = (parent_doc.version_number + 1) if parent_doc else 1
            classification = arrival.classification
            rel_kind = "updated_revision"
        else:
            rel = detect_document_relationship(db, case.id, file.sha256, file.name, f_ident)
            rel_kind = rel.kind
            parent_id = rel.parent_version_id
            ver_num = rel.version_number
            classification = (
                arrival.classification
                if arrival.classification and arrival.classification != "other"
                else (rel.classification or "other")
            )

        if rel_kind != "duplicate":
            has_non_duplicate = True

        doc_entries.append({
            "file": file,
            "parent_id": parent_id,
            "version_number": ver_num,
            "classification": classification,
            "is_duplicate": rel_kind == "duplicate",
        })

    if not has_non_duplicate and files:
        # All incoming documents are exact duplicates of documents already present in this case.
        # Preserve existing state and snapshot without creating duplicate processing runs.
        latest_run_id = db.scalar(
            select(AutomationRun.id)
            .where(AutomationRun.intake_case_id == case.id)
            .order_by(AutomationRun.created_at.desc())
            .limit(1)
        )
        if not latest_run_id:
            latest_run_id = uuid4()
        db.add(
            ActivityEvent(
                actor_type="staff",
                actor_id=user.id,
                intake_case_id=case.id,
                automation_run_id=None,
                event_type="arrival_archived",
                before_state=case.state,
                after_state=case.state,
            )
        )
        db.commit()
        return Receipt(case_id=case.id, run_id=latest_run_id, replayed=True)

    previous = case.state
    if case.state != "manual_matching":
        case.state = "queued"
    case.analysis_revision += 1
    case.detected_reference = None
    case.review_reason = None
    db.add_all(
        [
            Document(
                intake_case_id=case.id,
                source_message_id=message_id,
                parent_version_id=entry["parent_id"],
                version_number=entry["version_number"],
                original_filename=entry["file"].name,
                classification=entry["classification"],
                mime=entry["file"].mime,
                sha256=entry["file"].sha256,
                storage_key=entry["file"].sha256,
                size_bytes=entry["file"].size,
            )
            for entry in doc_entries
            if not entry["is_duplicate"]
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
            after_state=case.state,
        )
    )
    db.commit()
    return Receipt(case_id=case.id, run_id=run.id, replayed=False)


@router.post("/{case_id}/match-shipment", dependencies=mutation)
def match_shipment_endpoint(case_id: UUID, request: MatchShipment, db: DB, user: Staff):
    case = visible_case(db, case_id, lock=True)
    if case.state != "manual_matching":
        raise HTTPException(400, "Only cases awaiting manual matching can be matched.")

    if request.target_case_id:
        target = visible_case(db, request.target_case_id, lock=True)
        if target.id == case.id:
            raise HTTPException(422, "Target shipment cannot be the same case.")

        # To satisfy composite FK (source_message_id, intake_case_id) on documents,
        # copy incoming message to the target shipment first, then reassign documents to target case and new message.
        docs = db.scalars(select(Document).where(Document.intake_case_id == case.id)).all()
        msgs = db.scalars(select(IncomingMessage).where(IncomingMessage.intake_case_id == case.id)).all()

        msg_target_map = {}
        for msg in msgs:
            new_msg = IncomingMessage(
                workspace_id=msg.workspace_id,
                intake_case_id=target.id,
                channel=msg.channel,
                provider_message_id=f"{msg.provider_message_id}:merged:{uuid4().hex[:8]}",
                thread_id=msg.thread_id,
                sender=msg.sender,
                subject=msg.subject,
                body=msg.body,
                payload_hash=msg.payload_hash,
            )
            db.add(new_msg)
            db.flush()
            msg_target_map[msg.id] = new_msg.id

        for doc in docs:
            doc.intake_case_id = target.id
            if doc.source_message_id in msg_target_map:
                doc.source_message_id = msg_target_map[doc.source_message_id]
            rel = detect_document_relationship(
                db,
                target.id,
                doc.sha256,
                doc.original_filename,
                ExtractedIdentifiers(doc_type=doc.classification),
            )
            doc.parent_version_id = rel.parent_version_id
            doc.version_number = rel.version_number
            if rel.classification != "other":
                doc.classification = rel.classification
        db.flush()

        target.analysis_revision += 1
        target.state = "queued"
        target.review_reason = None
        enqueue(db, target.id, target.analysis_revision)

        case.state = "rejected"
        case.review_reason = f"Manually matched and merged into shipment {target.id}."
        db.add(
            ActivityEvent(
                actor_type="staff",
                actor_id=user.id,
                intake_case_id=target.id,
                event_type="shipment_manually_matched",
                before_state="manual_matching",
                after_state="queued",
            )
        )
        db.commit()
        return {"status": "matched", "target_case_id": target.id}
    else:
        # Confirm as new independent shipment
        case.state = "queued"
        case.review_reason = "Manual match confirmed as independent new shipment."
        enqueue(db, case.id, case.analysis_revision)
        db.add(
            ActivityEvent(
                actor_type="staff",
                actor_id=user.id,
                intake_case_id=case.id,
                event_type="manual_matching_confirmed_new",
                before_state="manual_matching",
                after_state="queued",
            )
        )
        db.commit()
        return {"status": "confirmed_new", "case_id": case.id}


class ConfirmFinalBl(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=1)


@router.post("/{case_id}/confirm-final-bl", dependencies=mutation)
def confirm_final_bl(case_id: UUID, payload: ConfirmFinalBl, db: DB, user: Staff):
    case = visible_case(db, case_id, lock=True)
    snapshot = db.scalar(select(ReviewSnapshot.id).where(ReviewSnapshot.intake_case_id == case.id, ReviewSnapshot.revision == case.analysis_revision))
    if payload.expected_revision != case.analysis_revision or snapshot is None:
        raise HTTPException(409, "Refresh and review the current document revision before confirming the Final B/L")
    all_docs = db.scalars(select(Document).where(Document.intake_case_id == case.id)).all()
    superseded = {d.parent_version_id for d in all_docs if d.parent_version_id}
    active_docs = [d for d in all_docs if d.id not in superseded]

    final_bl_docs = [d for d in active_docs if d.classification == "final_bl"]
    if len(final_bl_docs) != 1:
        raise HTTPException(422, "Choose one unambiguous active Final B/L document for confirmation.")
    if case.final_bl_confirmed_revision == case.analysis_revision:
        return {"status": "confirmed", "case_id": case.id}
    case.final_bl_confirmed_revision = case.analysis_revision
    # Final-document receipt is a separate scope from document/CDC review and intake approval.
    # Preserve open findings and approved business dates until their own reviewed approval.

    db.add(
        ActivityEvent(
            actor_type="staff",
            actor_id=user.id,
            intake_case_id=case.id,
            event_type="final_bl_confirmed",
            before_state=case.state,
            after_state=case.state,
        )
    )
    db.commit()
    return {"status": "confirmed", "case_id": case.id}


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
