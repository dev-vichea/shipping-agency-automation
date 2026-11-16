from contextlib import contextmanager
from typing import Annotated, Literal
from uuid import UUID

import pymupdf
from fastapi import APIRouter, HTTPException, Path, Query
from fastapi.responses import FileResponse
from openpyxl.utils import get_column_letter
from pydantic import BaseModel
from sqlalchemy import select
from starlette.responses import Response

from shipping_ai.core.access import case_access
from shipping_ai.core.auth import DB, Staff
from shipping_ai.core.config import settings
from shipping_ai.models import Document, IntakeCase
from shipping_ai.review.values import clean, folded

from .extract import PDF_LOCK, read_supplier_workbook
from .storage import LocalStorage

router = APIRouter(prefix="/documents", tags=["documents"])
PageNumber = Annotated[int, Path(ge=1)]
Rotation = Literal["0", "90", "180", "270"]
PREVIEW_HEADERS = {"cache-control": "private, no-store", "x-content-type-options": "nosniff"}


def get_original(db, document_id):
    doc = db.scalar(
        select(Document).join(IntakeCase).where(Document.id == document_id, case_access(db))
    )
    if doc is None:
        raise HTTPException(404, "Document not found")
    return doc


@router.get("/{document_id}/download", response_class=FileResponse)
def download(document_id: UUID, db: DB, _user: Staff):
    doc = get_original(db, document_id)
    path = LocalStorage(settings().storage_dir).path(doc.storage_key)
    if not path.is_file():
        raise HTTPException(404, "Archived file is unavailable")
    return FileResponse(
        path,
        filename=doc.original_filename,
        media_type="application/octet-stream",
        headers={"content-security-policy": "sandbox", "referrer-policy": "no-referrer"},
    )


class PageInfo(BaseModel):
    pages: int
    width: float
    height: float
    box: tuple[float, float, float, float] | None = None


@contextmanager
def pdf_page(db: DB, document_id: UUID, number: int, rotation: Rotation):
    doc = get_original(db, document_id)
    if doc.mime != "application/pdf":
        raise HTTPException(415, "Page preview requires a PDF original")
    store = LocalStorage(settings().storage_dir)
    try:
        original = store.path(doc.storage_key).open("rb")
    except FileNotFoundError:
        raise HTTPException(404, "Archived file is unavailable") from None
    with original:
        data = original.read(settings().max_file_bytes + 1)
    if len(data) > settings().max_file_bytes:
        raise HTTPException(422, "Archived file exceeds the preview limit")
    with PDF_LOCK:
        try:
            with pymupdf.open(stream=data, filetype="pdf") as pdf:
                if pdf.needs_pass or pdf.is_repaired:
                    raise HTTPException(422, "This PDF cannot be previewed")
                if number > pdf.page_count:
                    raise HTTPException(404, "Page not found")
                page = pdf[number - 1]
                page.set_rotation((page.rotation + int(rotation)) % 360)
                width, height = page.rect.width, page.rect.height
                if min(width, height) <= 0 or max(width, height) > 1800:
                    raise HTTPException(422, "PDF page exceeds the preview dimensions")
                yield page, pdf.page_count
        except (pymupdf.FileDataError, RuntimeError, ValueError):
            raise HTTPException(422, "This PDF cannot be previewed") from None


@router.get("/{document_id}/pages/{number}", response_model=PageInfo)
def page_info(
    document_id: UUID,
    number: PageNumber,
    db: DB,
    _user: Staff,
    response: Response,
    rotation: Rotation = "0",
    line: Annotated[int | None, Query(ge=1)] = None,
):
    response.headers.update(PREVIEW_HEADERS)
    with pdf_page(db, document_id, number, rotation) as (page, count):
        info = PageInfo(pages=count, width=page.rect.width, height=page.rect.height)
        if line is None:
            return info
        text_page = page.get_textpage(flags=pymupdf.TEXTFLAGS_TEXT)
        raw_lines = page.get_text(textpage=text_page).splitlines()
        if line > len(raw_lines) or not (target := folded(clean(raw_lines[line - 1]))):
            return info
        positioned_lines = [
            (folded("".join(span["text"] for span in candidate["spans"])), candidate["bbox"])
            for block in page.get_text("dict", textpage=text_page)["blocks"]
            for candidate in block.get("lines", [])
        ]
        # The citation records a line number. Repeated text can belong to different cells.
        if len(positioned_lines) == len(raw_lines) and positioned_lines[line - 1][0] == target:
            coordinates = positioned_lines[line - 1][1]
        else:
            matches = [coordinates for text, coordinates in positioned_lines if text == target]
            if len(matches) != 1:
                return info
            coordinates = matches[0]
        box = (pymupdf.Rect(coordinates) * page.rotation_matrix) & page.rect
        if box.is_empty:
            return info
        info.box = (
            box.x0 / page.rect.width,
            box.y0 / page.rect.height,
            box.width / page.rect.width,
            box.height / page.rect.height,
        )
        return info


@router.get("/{document_id}/pages/{number}/image", response_class=Response)
def page_image(
    document_id: UUID, number: PageNumber, db: DB, _user: Staff, rotation: Rotation = "0"
):
    with pdf_page(db, document_id, number, rotation) as (page, _):
        # Standard pages render at 300 DPI. Large pages stay within a pixel budget.
        dpi = min(300, int(72 * (12_000_000 / page.rect.get_area()) ** 0.5))
        pixels = page.get_pixmap(dpi=dpi, annots=False)
        return Response(pixels.tobytes("png"), media_type="image/png", headers=PREVIEW_HEADERS)


@router.get("/{document_id}/workbook")
def workbook_preview(
    document_id: UUID,
    db: DB,
    _user: Staff,
    sheet: Annotated[str | None, Query(max_length=100)] = None,
    offset: Annotated[int, Query(ge=0, le=5000)] = 0,
):
    doc = get_original(db, document_id)
    if not doc.original_filename.lower().endswith((".xls", ".xlsx")):
        raise HTTPException(415, "Workbook preview requires an Excel original")
    store = LocalStorage(settings().storage_dir)
    try:
        with store.path(doc.storage_key).open("rb") as archived:
            data = archived.read(settings().max_file_bytes + 1)
    except FileNotFoundError:
        raise HTTPException(404, "Archived file is unavailable") from None
    if len(data) > settings().max_file_bytes:
        raise HTTPException(422, "Workbook exceeds the preview limit")
    try:
        workbook = read_supplier_workbook(data, doc.original_filename)
    except Exception:
        raise HTTPException(422, "This workbook cannot be previewed") from None
    selected = sheet or next(iter(workbook), None)
    if selected not in workbook:
        raise HTTPException(404, "Worksheet not found")
    rows = workbook[selected]
    window = rows[offset : offset + 25]
    width = min(24, max((len(values) for _, values in window), default=0))
    return {
        "sheets": list(workbook),
        "sheet": selected,
        "total": len(rows),
        "columns": [get_column_letter(index + 1) for index in range(width)],
        "rows": [
            {"number": row, "values": [clean(value)[:180] for value in values[:width]]}
            for row, values in window
        ],
    }
