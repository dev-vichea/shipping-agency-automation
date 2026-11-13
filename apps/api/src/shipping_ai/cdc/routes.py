from datetime import UTC, date, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from shipping_ai.core.auth import DB, Staff, browser_origin
from shipping_ai.core.config import settings
from shipping_ai.documents.storage import InvalidUpload, LocalStorage
from shipping_ai.intakes.routes import Offset, PageSize
from shipping_ai.intakes.schemas import Key, Label
from shipping_ai.models import CdcMasterVersion
from shipping_ai.review.schemas import MasterView

from .master import approval_key, company_key, parse_master

router = APIRouter(prefix="/cdc/versions", tags=["CDC versions"])


class RegisterMaster(BaseModel):
    model_config = ConfigDict(extra="forbid")
    company: Label
    year: Annotated[int, Field(ge=2000, le=2100)]
    approval_ref: Key
    balance_as_of: date | None = None
    verified: bool


def view(master: CdcMasterVersion | None) -> MasterView | None:
    return MasterView.model_validate(master, from_attributes=True) if master else None


@router.get("", response_model=list[MasterView])
def list_versions(db: DB, _user: Staff, limit: PageSize = 30, offset: Offset = 0):
    return [
        view(master)
        for master in db.scalars(
            select(CdcMasterVersion)
            .order_by(CdcMasterVersion.created_at.desc(), CdcMasterVersion.id.desc())
            .offset(offset)
            .limit(limit)
        )
    ]


@router.post("", status_code=201, response_model=MasterView, dependencies=[Depends(browser_origin)])
async def register(request: Request, response: Response, db: DB, user: Staff):
    if (
        request.headers.get("content-type", "").split(";")[0].strip().lower()
        != "multipart/form-data"
    ):
        raise HTTPException(415, "Use multipart/form-data")
    async with request.form(max_files=1, max_fields=5, max_part_size=2048) as form:
        upload = form.get("file")
        parts = [(key, val) for key, val in form.multi_items() if key != "file"]
        if not isinstance(upload, UploadFile) or not (upload.filename or "").lower().endswith(
            (".xls", ".xlsx")
        ):
            raise HTTPException(415, "Upload one XLS or XLSX Master List")
        if len(dict(parts)) != len(parts):
            raise HTTPException(422, "Repeated master list metadata")
        try:
            metadata = RegisterMaster.model_validate(dict(parts))
        except ValidationError:
            raise HTTPException(422, "Invalid master list metadata") from None
        if not metadata.verified:
            raise HTTPException(422, "Confirm the source workbook was checked against the approval")
        if metadata.balance_as_of and metadata.balance_as_of > datetime.now(UTC).date():
            raise HTTPException(422, "Balance date cannot be in the future")
        return await run_in_threadpool(save_master, db, user.id, upload, metadata, response)


def save_master(db, user_id, upload, metadata, response):
    store = LocalStorage(settings().storage_dir)
    try:
        saved = store.store(
            upload.file, upload.filename, upload.content_type or "", settings().max_file_bytes
        )
    except InvalidUpload as exc:
        raise HTTPException(exc.status, str(exc)) from None
    source_id = uuid4()
    try:
        parsed = parse_master(store.path(saved.sha256).read_bytes(), saved.name, source_id)
    except Exception:
        raise HTTPException(
            422, "The workbook is unreadable or does not use a supported CDC layout"
        ) from None
    key = company_key(metadata.company)
    if not key or (parsed.company and company_key(parsed.company) != key):
        raise HTTPException(422, "The workbook company differs from the supplied company")
    ref = approval_key(metadata.approval_ref)
    if not ref or (parsed.approval_ref and approval_key(parsed.approval_ref) != ref):
        raise HTTPException(
            422, "The workbook approval reference differs from the supplied reference"
        )
    values = dict(
        company=metadata.company,
        company_key=key,
        year=metadata.year,
        approval_ref=ref,
        layout=parsed.layout,
        source_id=source_id,
        original_filename=saved.name,
        sha256=saved.sha256,
        size_bytes=saved.size,
        balance_as_of=metadata.balance_as_of,
        verified_by=user_id,
        items=[item.model_dump(mode="json") for item in parsed.items],
    )
    master_id = db.scalar(
        insert(CdcMasterVersion)
        .values(**values)
        .on_conflict_do_nothing(constraint="uq_cdc_version")
        .returning(CdcMasterVersion.id)
    )
    if master_id is None:
        master = db.scalar(
            select(CdcMasterVersion).filter_by(
                company_key=key, year=metadata.year, approval_ref=ref, sha256=saved.sha256
            )
        )
        if master.balance_as_of != metadata.balance_as_of:
            raise HTTPException(409, "This version already has a different recorded balance date")
        response.status_code = 200
    else:
        master = db.get(CdcMasterVersion, master_id)
    result = view(master)
    db.commit()
    return result


@router.get("/{version_id}/download", response_class=FileResponse)
def download_version(version_id: UUID, db: DB, _user: Staff):
    master = db.get(CdcMasterVersion, version_id)
    if master is None:
        raise HTTPException(404, "Master List not found")
    path = LocalStorage(settings().storage_dir).path(master.sha256)
    if not path.is_file():
        raise HTTPException(404, "Archived file is unavailable")
    return FileResponse(
        path,
        filename=master.original_filename,
        media_type="application/octet-stream",
        headers={"content-security-policy": "sandbox", "referrer-policy": "no-referrer"},
    )
