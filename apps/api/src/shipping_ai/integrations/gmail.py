import base64
import binascii
import hashlib
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parseaddr
from io import BytesIO
from pathlib import PurePath
from uuid import UUID

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from pydantic import ValidationError
from redis import Redis
from redis.exceptions import LockNotOwnedError
from sqlalchemy import select

from shipping_ai.core.access import Access
from shipping_ai.core.config import settings
from shipping_ai.core.db import session_factory
from shipping_ai.documents.storage import InvalidUpload, LocalStorage
from shipping_ai.intakes.routes import archive_arrival
from shipping_ai.intakes.schemas import Arrival
from shipping_ai.models import GmailConnection, IncomingMessage, IntakeCase, User, WorkspaceMember

GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
TOKEN_URL = "https://oauth2.googleapis.com/token"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
CALLBACK = "/api/v1/integrations/gmail/callback"
EXTENSIONS = {".pdf", ".xls", ".xlsx"}


class GmailError(Exception):
    def __init__(self, code: str):
        self.code = code


@dataclass(frozen=True)
class Mailbox:
    workspace_id: UUID
    email: str
    credential: bytes
    history_id: str
    owner_id: UUID
    senders: tuple[str, ...]
    company_id: UUID | None


def cipher():
    config = settings()
    try:
        return Fernet(config.connector_key.get_secret_value()) if config.connector_key else None
    except (ValueError, TypeError):
        return None


def configured():
    config = settings()
    return bool(
        config.gmail_client_id
        and config.gmail_client_secret
        and config.gmail_client_secret.get_secret_value()
        and cipher()
    )


def credentials():
    config = settings()
    return {
        "client_id": config.gmail_client_id,
        "client_secret": config.gmail_client_secret.get_secret_value(),
    }


def token(client, **values):
    try:
        response = client.post(TOKEN_URL, data={**credentials(), **values})
        if response.status_code == 400 and response.json().get("error") == "invalid_grant":
            raise GmailError("gmail_reconnect_required")
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload.get("access_token"), str):
            raise GmailError("gmail_token_missing")
        return payload
    except (ValueError, httpx.HTTPError) as exc:
        raise GmailError("gmail_token_unavailable") from exc


def get(client, access_token, path, *, params=None, max_bytes=2_000_000):
    headers = {"Authorization": f"Bearer {access_token}", "Accept-Encoding": "identity"}
    try:
        with client.stream("GET", f"{GMAIL}/{path}", params=params, headers=headers) as response:
            if response.status_code == 404:
                raise GmailError(
                    "gmail_history_expired" if path == "history" else "gmail_message_missing"
                )
            response.raise_for_status()
            content = bytearray()
            for chunk in response.iter_bytes():
                content.extend(chunk)
                if len(content) > max_bytes:
                    raise GmailError("gmail_response_too_large")
        return httpx.Response(200, content=content).json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GmailError("gmail_unavailable") from exc


def active_owner(db, workspace_id, owner_id):
    return db.scalar(
        select(User)
        .join(WorkspaceMember)
        .where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.role == "admin",
            User.id == owner_id,
            User.active.is_(True),
        )
    )


def sync_all():
    if not configured():
        return
    with session_factory()() as db:
        workspaces = db.scalars(
            select(GmailConnection.workspace_id).where(GmailConnection.enabled.is_(True))
        ).all()
    for workspace in workspaces:
        with Redis.from_url(str(settings().redis_url), socket_timeout=2) as redis:
            lock = redis.lock(f"shipping:gmail:{workspace}", timeout=180, blocking_timeout=0)
            if not lock.acquire(blocking=False):
                continue
            try:
                sync_workspace(workspace)
            finally:
                try:
                    lock.release()
                except LockNotOwnedError:
                    pass


def unchanged(connection, mailbox):
    return bool(
        connection
        and connection.enabled
        and connection.credential == mailbox.credential
        and connection.history_id == mailbox.history_id
        and tuple(connection.senders) == mailbox.senders
        and connection.company_id == mailbox.company_id
    )


def sync_workspace(workspace_id):
    with session_factory().begin() as db:
        connection = db.get(GmailConnection, workspace_id)
        if not connection or not connection.enabled:
            return
        if not active_owner(db, workspace_id, connection.owner_id):
            connection.enabled = False
            connection.error_code = "gmail_owner_access_revoked"
            return
        mailbox = Mailbox(
            workspace_id,
            connection.mailbox,
            connection.credential,
            connection.history_id,
            connection.owner_id,
            tuple(connection.senders),
            connection.company_id,
        )
    try:
        with httpx.Client(timeout=httpx.Timeout(8, connect=3)) as client:
            refresh = cipher().decrypt(mailbox.credential).decode()
            access = token(client, refresh_token=refresh, grant_type="refresh_token")[
                "access_token"
            ]
            history = get(
                client,
                access,
                "history",
                params={
                    "startHistoryId": mailbox.history_id,
                    "historyTypes": "messageAdded",
                    "maxResults": 10,
                },
            )
            entries = history.get("history", [])
            for entry in entries:
                for record in entry.get("messagesAdded", []):
                    ident = record["message"]["id"]
                    if not isinstance(ident, str) or not ident.isalnum() or len(ident) > 64:
                        continue
                    process_message(client, access, mailbox, ident)
            cursor = (
                entries[-1]["id"]
                if history.get("nextPageToken") and entries
                else history.get("historyId")
            )
            if not cursor or not str(cursor).isdigit() or len(str(cursor)) > 32:
                raise GmailError("gmail_history_invalid")
            error = None
    except InvalidToken:
        error, cursor = "gmail_credential_unavailable", None
    except GmailError as issue:
        error, cursor = issue.code, None
    except (KeyError, TypeError, ValueError, ValidationError):
        error, cursor = "gmail_response_invalid", None
    with session_factory().begin() as db:
        connection = db.get(GmailConnection, workspace_id, with_for_update=True)
        if unchanged(connection, mailbox):
            connection.error_code = error
            if not error:
                connection.history_id = str(cursor)
                connection.last_synced_at = datetime.now(UTC)


def parts(payload):
    stack = [payload]
    while stack:
        part = stack.pop()
        stack.extend(reversed(part.get("parts") or []))
        yield part


def decoded(value: str):
    return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)


def metadata(message):
    root = message.get("payload") or {}
    headers = {entry["name"].lower(): entry.get("value", "") for entry in root.get("headers", [])}
    sender = parseaddr(headers.get("from", ""))[1].strip().casefold()
    return root, sender, headers.get("subject", "")[:200]


def attachments(client, access_token, ident, root):
    config = settings()
    storage = LocalStorage(config.storage_dir)
    files, plain = {}, None
    for part in parts(root):
        filename = part.get("filename", "")
        mime = part.get("mimeType", "")
        body = part.get("body") or {}
        if (
            not filename
            and plain is None
            and mime == "text/plain"
            and body.get("data")
            and len(body["data"]) <= 90_000
        ):
            try:
                plain = (
                    decoded(body["data"])
                    .decode("utf-8", errors="replace")[:16_000]
                    .replace("\x00", "")
                )
            except (ValueError, binascii.Error):
                pass
        if (
            len(files) >= config.max_files
            or PurePath(filename).suffix.lower() not in EXTENSIONS
            or not 0 < body.get("size", 0) <= config.max_file_bytes
        ):
            continue
        if ident_part := body.get("attachmentId"):
            if (
                not isinstance(ident_part, str)
                or not ident_part.replace("-", "").replace("_", "").isalnum()
            ):
                continue
            body = get(
                client,
                access_token,
                f"messages/{ident}/attachments/{ident_part}",
                max_bytes=(config.max_file_bytes * 4 // 3) + 4096,
            )
        value = body.get("data")
        if not isinstance(value, str) or len(value) > (config.max_file_bytes * 4 // 3) + 4:
            continue
        try:
            saved = storage.store(BytesIO(decoded(value)), filename, mime, config.max_file_bytes)
        except (InvalidUpload, ValueError, binascii.Error):
            continue
        files[saved.sha256] = saved
    return files, plain


def process_message(client, access_token, mailbox, ident):
    namespace = hashlib.sha256(mailbox.email.casefold().encode()).hexdigest()[:24]
    provider_id = f"{namespace}:{ident}"
    with session_factory()() as db:
        if db.scalar(
            select(IncomingMessage.id).where(
                IncomingMessage.workspace_id == mailbox.workspace_id,
                IncomingMessage.channel == "gmail",
                IncomingMessage.provider_message_id == provider_id,
            )
        ):
            return
    try:
        message = get(client, access_token, f"messages/{ident}", params={"format": "full"})
    except GmailError as exc:
        if exc.code == "gmail_message_missing":  # Message was removed before the poll.
            return
        raise
    labels = message.get("labelIds", [])
    if "INBOX" not in labels or set(labels) & {"SENT", "SPAM", "TRASH", "DRAFT"}:
        return
    root, sender, subject = metadata(message)
    if sender not in mailbox.senders:
        return
    files, plain = attachments(client, access_token, ident, root)
    if not files:
        return
    thread = message.get("threadId")
    thread_id = (
        f"{namespace}:{thread}"
        if isinstance(thread, str) and thread.isalnum() and len(thread) <= 64
        else None
    )
    with session_factory()() as db:
        connection = db.get(GmailConnection, mailbox.workspace_id, with_for_update=True)
        owner = active_owner(db, mailbox.workspace_id, mailbox.owner_id)
        if not unchanged(connection, mailbox) or owner is None:
            return
        db.info["access"] = Access(mailbox.workspace_id, owner.id, True)
        # A private mail thread, exact sender and configured company must all agree.
        case_id = None
        if thread_id and mailbox.company_id:
            matches = db.execute(
                select(IntakeCase.id, IntakeCase.detected_reference)
                .join(IncomingMessage)
                .where(
                    IntakeCase.workspace_id == mailbox.workspace_id,
                    IntakeCase.company_id == mailbox.company_id,
                    IntakeCase.state.in_(("queued", "needs_review", "ready_for_approval")),
                    IncomingMessage.channel == "gmail",
                    IncomingMessage.thread_id == thread_id,
                    IncomingMessage.sender == sender,
                    IncomingMessage.subject == subject,
                )
                .distinct()
                .limit(2)
            ).all()
            references = [
                ident
                for ident, reference in matches
                if reference
                and re.search(rf"(?<![\w-]){re.escape(reference)}(?![\w-])", subject, flags=re.I)
            ]
            if len(references) == 1:
                case_id = references[0]
        arrival = Arrival(
            provider_message_id=provider_id,
            thread_id=thread_id,
            sender=sender,
            subject=subject,
            body=plain,
            intake_case_id=case_id,
            company_id=mailbox.company_id,
        )
        try:
            archive_arrival(db, owner, arrival, files, "gmail", received_at=message_time(message))
        except HTTPException as exc:
            raise GmailError("gmail_archive_conflict") from exc


def message_time(payload):
    try:
        milliseconds = int(payload.get("internalDate") or 0)
        return datetime.fromtimestamp(milliseconds / 1000, tz=UTC) if milliseconds > 0 else None
    except (OverflowError, OSError, TypeError, ValueError):
        return None
