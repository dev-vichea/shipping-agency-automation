from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import PurePath
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from services.extraction import extract_cdc, rows_from_workbook

from shipping_ai.core.access import master_access, require_workspace, visible_company
from shipping_ai.core.auth import DB, Staff, browser_origin
from shipping_ai.core.config import settings
from shipping_ai.documents.storage import InvalidUpload, LocalStorage, safe_name, validate_format
from shipping_ai.intakes.routes import Offset, PageSize
from shipping_ai.intakes.schemas import Key, Label
from shipping_ai.models import CdcMasterVersion, Company
from shipping_ai.review.schemas import MasterItem, MasterView

from .master import (
    approval_key,
    classify_item_description,
    company_key,
    detect_categories_for_rows,
    parse_master,
)
from .preview import MasterPreview, preview
from .reservations import totals

router = APIRouter(prefix="/cdc/versions", tags=["CDC versions"])


class RegisterMaster(BaseModel):
    model_config = ConfigDict(extra="forbid")
    company: Label
    company_id: UUID | None = None
    year: Annotated[int, Field(ge=2000, le=2100)]
    approval_ref: Key
    balance_as_of: date | None = None
    verified: bool


def view(master: CdcMasterVersion | None) -> MasterView | None:
    return MasterView.model_validate(master, from_attributes=True) if master else None


@router.get("", response_model=list[MasterView])
def list_versions(
    db: DB,
    _user: Staff,
    limit: PageSize = 30,
    offset: Offset = 0,
    company_id: UUID | None = None,
):
    filters = [master_access(db)]
    if company_id:
        visible_company(db, company_id)
        filters.append(CdcMasterVersion.company_id == company_id)
    return [
        view(master)
        for master in db.scalars(
            select(CdcMasterVersion)
            .where(*filters)
            .order_by(CdcMasterVersion.created_at.desc(), CdcMasterVersion.id.desc())
            .offset(offset)
            .limit(limit)
        )
    ]


@router.post("/preview", response_model=MasterPreview, dependencies=[Depends(browser_origin)])
async def inspect_workbook(request: Request, db: DB, _user: Staff):
    workspace = require_workspace(db, admin=True)
    if (
        request.headers.get("content-type", "").split(";")[0].strip().lower()
        != "multipart/form-data"
    ):
        raise HTTPException(415, "Use multipart/form-data")
    async with request.form(max_files=2, max_fields=0) as form:
        if set(form) - {"file", "approval_pdf"} or len(form.multi_items()) != len(form):
            raise HTTPException(422, "Upload one workbook and at most one approval PDF")
        return await run_in_threadpool(
            inspect_files,
            db,
            workspace,
            form.get("file"),
            form.get("approval_pdf"),
        )


def inspect_files(db, workspace, workbook, approval_pdf):
    data, name = read_preview_file(
        workbook, {".xls", ".xlsx"}, "Upload one XLS or XLSX Master List"
    )
    approval = (
        read_preview_file(approval_pdf, {".pdf"}, "The approval document must be a PDF")
        if approval_pdf is not None
        else None
    )
    try:
        result = preview(data, name, approval)
    except Exception:
        raise HTTPException(
            422, "The workbook is unreadable or does not use a supported CDC layout"
        ) from None
    if suggestion := result.fields.get("company"):
        key = company_key(suggestion.value)
        matches = [
            company.id
            for company in db.scalars(select(Company).where(Company.workspace_id == workspace))
            if key in {company_key(value) for value in (company.name, *company.aliases)}
        ]
        if len(matches) == 1:
            result.company_id = matches[0]
        elif len(matches) > 1:
            result.warnings.append(
                "More than one workspace company matches the name. Choose the linked company."
            )
    return result


def read_preview_file(upload, extensions, invalid_message):
    if not isinstance(upload, UploadFile):
        raise HTTPException(422, invalid_message)
    limit = settings().max_file_bytes
    if upload.size is not None and upload.size > limit:
        raise HTTPException(413, "Attachment exceeds file size limit")
    try:
        name = safe_name(upload.filename or "")
        extension = PurePath(name).suffix.lower()
        if extension not in extensions:
            raise InvalidUpload(invalid_message)
        validate_format(upload.file, extension)
    except InvalidUpload as exc:
        raise HTTPException(exc.status, str(exc)) from None
    upload.file.seek(0)
    data = upload.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, "Attachment exceeds file size limit")
    return data, name


@router.post("", status_code=201, response_model=MasterView, dependencies=[Depends(browser_origin)])
async def register(request: Request, response: Response, db: DB, user: Staff):
    require_workspace(db, admin=True)
    if (
        request.headers.get("content-type", "").split(";")[0].strip().lower()
        != "multipart/form-data"
    ):
        raise HTTPException(415, "Use multipart/form-data")
    async with request.form(max_files=1, max_fields=6, max_part_size=2048) as form:
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
    workspace = require_workspace(db, admin=True)
    company = visible_company(db, metadata.company_id) if metadata.company_id else None
    key = company_key(metadata.company)
    if company and key not in {company_key(value) for value in [company.name, *company.aliases]}:
        raise HTTPException(422, "Workbook company must match the selected company or an alias")
    if company is None:
        companies = [
            candidate
            for candidate in db.scalars(select(Company).where(Company.workspace_id == workspace))
            if key in {company_key(value) for value in [candidate.name, *candidate.aliases]}
        ]
        if len(companies) > 1:
            raise HTTPException(422, "Select the company for this workbook")
        company = companies[0] if companies else None
    if not key or (parsed.company and company_key(parsed.company) != key):
        raise HTTPException(422, "The workbook company differs from the supplied company")
    ref = approval_key(metadata.approval_ref)
    if not ref or (parsed.approval_ref and approval_key(parsed.approval_ref) != ref):
        raise HTTPException(
            422, "The workbook approval reference differs from the supplied reference"
        )
    values = dict(
        workspace_id=workspace,
        company_id=company.id if company else None,
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
                workspace_id=workspace,
                company_key=key,
                year=metadata.year,
                approval_ref=ref,
                sha256=saved.sha256,
            )
        )
        if company and master.company_id not in (None, company.id):
            raise HTTPException(409, "This version belongs to a different company")
        if company and master.company_id is None:
            master.company_id = company.id
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
    master = db.scalar(
        select(CdcMasterVersion).where(CdcMasterVersion.id == version_id, master_access(db))
    )
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


class MasterItemsView(BaseModel):
    version: MasterView
    items: list[MasterItem]
    total: int
    categories: list[str] = []
    category_counts: dict[str, int] = {}
    internally_reserved: dict[int, Decimal]


@router.get("/{version_id}/items", response_model=MasterItemsView)
def list_items(
    version_id: UUID,
    db: DB,
    _user: Staff,
    limit: PageSize = 30,
    offset: Offset = 0,
    q: Annotated[str | None, Query(max_length=160)] = None,
    category: Annotated[str | None, Query(max_length=100)] = None,
):
    master = db.scalar(
        select(CdcMasterVersion).where(CdcMasterVersion.id == version_id, master_access(db))
    )
    if master is None:
        raise HTTPException(404, "Master List not found")

    needs_save = False
    all_items = []
    category_counts: dict[str, int] = {}

    row_cats: dict[int, str] = {}
    missing_category = any(not item.get("category") for item in master.items)
    if missing_category:
        storage = LocalStorage(settings().storage_dir)
        raw_path = storage.path(master.sha256)
        if raw_path.exists():
            try:
                data = raw_path.read_bytes()
                meta, _ = extract_cdc(data, master.original_filename)
                sheet = meta.get("sheet", "")
                workbook = dict(rows_from_workbook(data, master.original_filename))
                rows = workbook.get(sheet, [])
                row_cats = detect_categories_for_rows(rows, sheet)
            except Exception:
                row_cats = {}

    for raw_item in master.items:
        item = dict(raw_item)
        if not item.get("category"):
            resolved = row_cats.get(item["row"]) or classify_item_description(
                item.get("description", {}).get("value")
            )
            item["category"] = resolved
            needs_save = True
        cat = item["category"] or "General"
        category_counts[cat] = category_counts.get(cat, 0) + 1
        all_items.append(item)

    if needs_save:
        master.items = all_items
        db.commit()

    categories = [cat for cat in category_counts.keys() if cat != "All"]
    category_counts["All"] = len(all_items)

    term = (q or "").strip().casefold()
    selected_cat = (category or "").strip()
    if selected_cat.lower() == "all":
        selected_cat = ""

    filtered = [
        row
        for row in all_items
        if (not selected_cat or (row.get("category") or "").casefold() == selected_cat.casefold())
        and (
            not term
            or term in (row["description"].get("value") or "").casefold()
            or term == str(row["row"])
        )
    ]
    return {
        "version": view(master),
        "items": filtered[offset : offset + limit],
        "total": len(filtered),
        "categories": categories,
        "category_counts": category_counts,
        "internally_reserved": {
            row: quantity for row, (quantity, _) in totals(db, master.id).items()
        },
    }
