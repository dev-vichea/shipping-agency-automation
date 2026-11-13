import hashlib
import os
import re
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO
from zipfile import BadZipFile, ZipFile

TYPES = {
    ".pdf": "application/pdf",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
CHUNK = 64 * 1024
XLS_MAGIC = bytes.fromhex("d0cf11e0a1b11ae1")


class InvalidUpload(Exception):
    def __init__(self, message: str, status: int = 415):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class StoredFile:
    name: str
    mime: str
    sha256: str
    size: int


def safe_name(raw: str) -> str:
    # Keep the displayed basename, never a user-controlled disk path.
    name = unicodedata.normalize("NFC", raw.replace("\\", "/").rsplit("/", 1)[-1])
    name = "".join(c for c in name if not unicodedata.category(c).startswith("C")).strip()
    if not name or name in {".", ".."} or len(name) > 255:
        raise InvalidUpload("Invalid attachment name")
    return name


def validate_format(file: BinaryIO, ext: str) -> None:
    file.seek(0)
    head = file.read(8)
    if ext == ".pdf" and head.startswith(b"%PDF-"):
        return
    if ext == ".xls" and head == XLS_MAGIC:
        # OLE container, archived opaquely. No Office or macro execution on this path.
        return
    if ext == ".xlsx" and head.startswith(b"PK\x03\x04"):
        try:
            with ZipFile(file) as zipfile:
                names = set(zipfile.namelist())
                if {"[Content_Types].xml", "xl/workbook.xml"} <= names and not any(
                    "vbaproject" in name.casefold() for name in names
                ):
                    return
        except (BadZipFile, ValueError, UnicodeError):
            pass
    raise InvalidUpload("Attachment content does not match a supported PDF or Excel file")


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def path(self, key: str) -> Path:
        if re.fullmatch(r"[a-f0-9]{64}", key) is None:
            raise ValueError("Invalid storage key")
        return self.root / key[:2] / key

    def store(self, source: BinaryIO, filename: str, declared_mime: str, limit: int) -> StoredFile:
        name = safe_name(filename)
        ext = Path(name).suffix.lower()
        mime = TYPES.get(ext)
        if not mime or declared_mime.lower().strip() not in {"", mime, "application/octet-stream"}:
            raise InvalidUpload("Only PDF, XLS and XLSX attachments are supported")
        self.root.mkdir(parents=True, mode=0o700, exist_ok=True)
        size = 0
        digest = hashlib.sha256()
        with tempfile.NamedTemporaryFile(dir=self.root, mode="w+b") as temporary:
            while chunk := source.read(CHUNK):
                size += len(chunk)
                if size > limit:
                    raise InvalidUpload("Attachment exceeds file size limit", 413)
                digest.update(chunk)
                temporary.write(chunk)
            if not size:
                raise InvalidUpload("Empty attachments are not supported")
            temporary.flush()
            validate_format(temporary, ext)
            key = digest.hexdigest()
            destination = self.path(key)
            destination.parent.mkdir(mode=0o700, exist_ok=True)
            temporary.seek(0)
            os.fsync(temporary.fileno())
            try:
                os.link(temporary.name, destination)  # atomic; never overwrites an original
            except FileExistsError:
                pass
            # Make the directory entries durable before a DB transaction can reference the blob.
            for directory in (destination.parent, self.root):
                with_fd = os.open(directory, os.O_RDONLY)
                try:
                    os.fsync(with_fd)
                finally:
                    os.close(with_fd)
        return StoredFile(name=name, mime=mime, sha256=key, size=size)

    def verify(self, key: str, expected_size: int) -> bool:
        with self.path(key).open("rb") as original:
            if os.fstat(original.fileno()).st_size != expected_size:
                return False
            return hashlib.file_digest(original, "sha256").hexdigest() == key
