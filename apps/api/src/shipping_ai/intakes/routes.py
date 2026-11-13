import hashlib
import json
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from shipping_ai.core.auth import DB, Staff, browser_origin
from shipping_ai.core.config import settings
from shipping_ai.documents.storage import InvalidUpload, LocalStorage, StoredFile
from shipping_ai.models import (
    ActivityEvent,
    AutomationRun,
    Document,
    ImportRecord,
    IncomingMessage,
    IntakeCase,
    User,
)

from .schemas import Arrival, CaseDetail, CaseSummary, Receipt

router = APIRouter(prefix="/intakes", tags=["intakes"])
CHANNEL = "simulated"
PageSize = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100_000)]


@router.get("", response_model=list[CaseSummary])
def list_cases(db: DB, _user: Staff, limit: PageSize = 30, offset: Offset = 0):
    counts = (
        select(func.count(Document.id))
        .where(Document.intake_case_id == IntakeCase.id)
        .correlate(IntakeCase)
        .scalar_subquery()
    )
    subject = (
        select(IncomingMessage.subject)
        .where(IncomingMessage.intake_case_id == IntakeCase.id)
        .order_by(IncomingMessage.received_at.desc(), IncomingMessage.id.desc())
        .limit(1)
        .correlate(IntakeCase)
        .scalar_subquery()
    )
    rows = db.execute(
        select(IntakeCase, counts, subject)
        .order_by(IntakeCase.created_at.desc(), IntakeCase.id.desc())
        .offset(offset)
        .limit(limit)
    )
    return [summary(case, count, title) for case, count, title in rows]


def summary(case: IntakeCase, count: int, subject: str | None) -> dict:
    return {
        "id": case.id,
        "state": case.state,
        "channel": case.channel,
        "detected_reference": case.detected_reference,
        "review_reason": case.review_reason,
        "created_at": case.created_at,
        "updated_at": case.updated_at,
        "attachment_count": count,
        "subject": subject,
    }


@router.get("/{case_id}", response_model=CaseDetail)
def case_detail(case_id: UUID, db: DB, _user: Staff):
    case = db.get(IntakeCase, case_id)
    if not case:
        raise HTTPException(404, "Intake not found")
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
    return {
        **summary(case, len(documents), messages[0].subject if messages else None),
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
    if (
        request.headers.get("content-type", "").split(";")[0].strip().lower()
        != "multipart/form-data"
    ):
        raise HTTPException(415, "Use multipart/form-data")

    async with request.form(max_files=cfg.max_files, max_fields=8, max_part_size=64 * 1024) as form:
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
        if not uploads and not (arrival.subject or (arrival.body and arrival.body.strip())):
            raise HTTPException(422, "Provide a subject, message or attachment")
        if arrival.parent_version_id and (not arrival.intake_case_id or len(uploads) != 1):
            raise HTTPException(422, "A revision requires one file and its existing intake")

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
        receipt = await run_in_threadpool(archive_arrival, db, user, arrival, files)
        if receipt.replayed:
            response.status_code = 200
        return receipt


def archive_arrival(db: DB, user: User, arrival: Arrival, files: dict[str, StoredFile]) -> Receipt:
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
        case = db.get(IntakeCase, arrival.intake_case_id, with_for_update=True)
        if not case:
            raise HTTPException(404, "Intake not found")
    else:
        case = IntakeCase(channel=CHANNEL)
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
            channel=CHANNEL,
            provider_message_id=provider_id,
            sender=arrival.sender,
            subject=arrival.subject,
            body=arrival.body,
            thread_id=arrival.thread_id,
            payload_hash=fingerprint,
        )
        .on_conflict_do_nothing(index_elements=["channel", "provider_message_id"])
        .returning(IncomingMessage.id)
    )
    if message_id is None:
        db.rollback()
        existing = db.scalar(
            select(IncomingMessage).where(
                IncomingMessage.channel == CHANNEL,
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
