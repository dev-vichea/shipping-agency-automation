from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from shipping_ai.core.auth import DB, Staff
from shipping_ai.core.config import settings
from shipping_ai.models import Document

from .storage import LocalStorage

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("/{document_id}/download", response_class=FileResponse)
def download(document_id: UUID, db: DB, _user: Staff):
    doc = db.get(Document, document_id)
    if doc is None:
        raise HTTPException(404, "Document not found")
    path = LocalStorage(settings().storage_dir).path(doc.storage_key)
    if not path.is_file():
        raise HTTPException(404, "Archived file is unavailable")
    return FileResponse(
        path,
        filename=doc.original_filename,
        media_type="application/octet-stream",
        headers={"content-security-policy": "sandbox", "referrer-policy": "no-referrer"},
    )
