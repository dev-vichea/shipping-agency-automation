import hmac
import json
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, StringConstraints, ValidationError
from redis import Redis, RedisError
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from shipping_ai.core.access import Access, require_workspace, visible_company
from shipping_ai.core.auth import DB, Staff, browser_origin, digest
from shipping_ai.core.config import settings
from shipping_ai.documents.storage import InvalidUpload, LocalStorage
from shipping_ai.intakes.routes import archive_arrival
from shipping_ai.intakes.schemas import Arrival, Receipt, SafeText
from shipping_ai.models import (
    AutomationRun,
    Company,
    Document,
    FolderSource,
    IncomingMessage,
    IntakeCase,
)

from .gmail import active_owner

router = APIRouter(prefix="/integrations/folders", tags=["folder intake"])
mutation = [Depends(browser_origin)]
CHANNEL = "folder"


class FolderInput(BaseModel):
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100), SafeText
    ]
    company_id: UUID


class FolderEdit(FolderInput):
    enabled: bool


class FileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    group: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    subject: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200), SafeText
    ]


class Check(BaseModel):
    status: Literal[
        "ok", "waiting_for_files", "folder_unavailable", "file_rejected", "upload_retry"
    ]


class PairRequest(BaseModel):
    source_id: UUID
    code: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{43}$")]


def pair_redis():
    return Redis.from_url(str(settings().redis_url), socket_timeout=2)


def pairing_link(source, user):
    code = secrets.token_urlsafe(32)
    payload = json.dumps([str(user.id), str(source.company_id), digest(code)])
    try:
        with pair_redis() as redis:
            redis.set(f"shipping:folder-pair:{source.id}", payload, ex=300)
    except RedisError:
        raise HTTPException(503, "Folder setup is temporarily unavailable") from None
    return {"source_id": source.id, "code": code}


def folder_view(source, company, now):
    if not source.enabled:
        status = "paused"
    elif source.last_contact_at is None:
        status = "awaiting_setup"
    elif now - source.last_contact_at > timedelta(minutes=3):
        status = "offline"
    else:
        status = source.check_status or "connected"
    return {
        "id": source.id,
        "name": source.name,
        "company_id": source.company_id,
        "company": company,
        "enabled": source.enabled,
        "status": status,
        "last_checked_at": source.last_checked_at,
        "has_received": source.last_received_at is not None,
    }


@router.get("")
def folders(db: DB, _user: Staff):
    workspace = require_workspace(db, admin=True)
    rows = db.execute(
        select(FolderSource, Company.name)
        .join(Company)
        .where(FolderSource.workspace_id == workspace)
        .order_by(FolderSource.name, FolderSource.id)
    )
    now = datetime.now(UTC)
    return [folder_view(source, company, now) for source, company in rows]


def management_source(db, source_id):
    workspace = require_workspace(db, admin=True)
    source = db.scalar(
        select(FolderSource)
        .where(FolderSource.workspace_id == workspace, FolderSource.id == source_id)
        .with_for_update()
    )
    if source is None:
        raise HTTPException(404, "Watched folder not found")
    return source


@router.post("", status_code=201, dependencies=mutation)
def add_folder(payload: FolderInput, db: DB, user: Staff):
    workspace = require_workspace(db, admin=True)
    visible_company(db, payload.company_id)
    source = FolderSource(
        workspace_id=workspace,
        owner_id=user.id,
        key_hash=digest(secrets.token_urlsafe(32)),
        **payload.model_dump(),
    )
    db.add(source)
    db.flush()
    link = pairing_link(source, user)
    db.commit()
    return link


@router.post("/{source_id}/settings", status_code=204, dependencies=mutation)
def edit_folder(source_id: UUID, payload: FolderEdit, db: DB, _user: Staff):
    source = management_source(db, source_id)
    if source.company_id != payload.company_id:
        if source.last_received_at is not None:
            raise HTTPException(409, "Add a new source to watch this folder for another company")
        visible_company(db, payload.company_id)
        source.company_id = payload.company_id
    source.name = payload.name
    source.enabled = payload.enabled
    db.commit()


@router.post("/{source_id}/pairing", dependencies=mutation)
def new_pairing(source_id: UUID, db: DB, user: Staff):
    source = management_source(db, source_id)
    return pairing_link(source, user)


@router.post("/agent/pair")
def pair_agent(payload: PairRequest, db: DB):
    error = HTTPException(401, "Folder setup link expired. Open a new one in Harborway.")
    source = db.get(FolderSource, payload.source_id, with_for_update=True)
    if source is None:
        raise error
    redis_key = f"shipping:folder-pair:{source.id}"
    try:
        with pair_redis() as redis:
            saved = redis.get(redis_key)
            if saved is None:
                raise error
            owner_id, company_id, code_hash = json.loads(saved)
            if not hmac.compare_digest(code_hash, digest(payload.code)):
                raise error
            owner = active_owner(db, source.workspace_id, UUID(owner_id))
            if owner is None or source.company_id != UUID(company_id):
                raise error
            # All pairing-link issuers and consumers lock the same source.
            if redis.getdel(redis_key) is None:
                raise error
    except RedisError:
        raise HTTPException(503, "Folder setup is temporarily unavailable") from None
    key = secrets.token_urlsafe(32)
    source.key_hash = digest(key)
    source.owner_id = owner.id
    source.last_contact_at = None
    source.check_status = None
    db.commit()
    return {"key": f"{source.id}.{key}"}


def agent_source(db, authorization, *, lock=False):
    unauthorized = HTTPException(401, "Invalid folder connection key")
    scheme, _, credential = authorization.partition(" ")
    ident, _, key = credential.partition(".")
    if scheme.lower() != "bearer" or not re.fullmatch(r"[A-Za-z0-9_-]{43}", key):
        raise unauthorized
    try:
        source_id = UUID(ident)
    except ValueError:
        raise unauthorized from None
    source = db.get(FolderSource, source_id, with_for_update=lock)
    if source is None or not hmac.compare_digest(source.key_hash, digest(key)):
        raise unauthorized
    owner = active_owner(db, source.workspace_id, source.owner_id)
    if owner is None:
        raise unauthorized
    return source, owner


@router.get("/agent/config")
def agent_config(request: Request, db: DB):
    source, _ = agent_source(db, request.headers.get("authorization", ""))
    return {"enabled": source.enabled, "max_file_bytes": settings().max_file_bytes}


@router.post("/agent/check", status_code=204)
def agent_check(payload: Check, request: Request, db: DB):
    source, _ = agent_source(db, request.headers.get("authorization", ""), lock=True)
    now = datetime.now(UTC)
    source.last_contact_at = now
    if source.enabled:
        source.check_status = "connected" if payload.status == "ok" else payload.status
        if payload.status in {"ok", "waiting_for_files"}:
            source.last_checked_at = now
    db.commit()


def archive_folder_file(db, authorization, payload, stored):
    source, owner = agent_source(db, authorization, lock=True)
    if not source.enabled:
        raise HTTPException(409, "Watched folder is paused")
    db.info["access"] = Access(source.workspace_id, owner.id, True)
    thread = f"{source.id}:{payload.group}"
    provider_id = digest(f"{thread}:{stored.sha256}")
    previous = db.execute(
        select(IncomingMessage.intake_case_id, AutomationRun.id)
        .join(AutomationRun, AutomationRun.message_id == IncomingMessage.id)
        .where(
            IncomingMessage.workspace_id == source.workspace_id,
            IncomingMessage.channel == CHANNEL,
            IncomingMessage.provider_message_id == provider_id,
            AutomationRun.stage == "receipt",
        )
    ).one_or_none()
    if previous is not None:
        return Receipt(case_id=previous[0], run_id=previous[1], replayed=True)

    case = db.scalar(
        select(IntakeCase)
        .join(IncomingMessage)
        .where(
            IntakeCase.workspace_id == source.workspace_id,
            IntakeCase.company_id == source.company_id,
            IncomingMessage.workspace_id == source.workspace_id,
            IncomingMessage.channel == CHANNEL,
            IncomingMessage.thread_id == thread,
        )
        .order_by(IntakeCase.created_at.desc(), IntakeCase.id.desc())
        .limit(1)
        .with_for_update(of=IntakeCase)
    )
    case_id = case.id if case and case.state not in {"approved", "rejected"} else None
    parent_id = (
        db.scalar(
            select(Document.id)
            .where(Document.intake_case_id == case_id, Document.original_filename == stored.name)
            .order_by(Document.received_at.desc(), Document.id.desc())
            .limit(1)
        )
        if case_id
        else None
    )
    arrival = Arrival(
        provider_message_id=provider_id,
        thread_id=thread,
        sender=source.name,
        subject=payload.subject,
        company_id=source.company_id,
        intake_case_id=case_id,
        parent_version_id=parent_id,
    )
    source.last_received_at = datetime.now(UTC)
    return archive_arrival(db, owner, arrival, {stored.sha256: stored}, CHANNEL)


@router.post("/agent/upload", status_code=201, response_model=Receipt)
async def agent_upload(request: Request, response: Response, db: DB):
    authorization = request.headers.get("authorization", "")
    source, _ = await run_in_threadpool(agent_source, db, authorization)
    if not source.enabled:
        raise HTTPException(409, "Watched folder is paused")
    await run_in_threadpool(db.rollback)
    if request.headers.get("content-type", "").split(";")[0].lower() != "multipart/form-data":
        raise HTTPException(415, "Use multipart/form-data")

    cfg = settings()
    async with request.form(max_files=1, max_fields=2, max_part_size=1024) as form:
        uploads = form.getlist("file")
        entries = [(name, value) for name, value in form.multi_items() if name != "file"]
        if len(uploads) != 1 or not isinstance(uploads[0], UploadFile) or len(entries) != 2:
            raise HTTPException(422, "Provide one file and its folder details")
        try:
            payload = FileInput.model_validate(dict(entries))
        except ValidationError:
            raise HTTPException(422, "Invalid folder details") from None
        upload = uploads[0]
        store = LocalStorage(cfg.storage_dir)
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
        receipt = await run_in_threadpool(archive_folder_file, db, authorization, payload, stored)
    if receipt.replayed:
        response.status_code = 200
    return receipt
