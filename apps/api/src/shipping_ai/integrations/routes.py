import hashlib
import hmac
import json
import re
import secrets
from base64 import urlsafe_b64encode
from typing import Annotated
from urllib.parse import urlencode
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field, StringConstraints
from redis import Redis, RedisError
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from shipping_ai.approvals.review import latest_review
from shipping_ai.approvals.routes import Decision, approve, reject
from shipping_ai.core.access import require_workspace, visible_case, visible_company
from shipping_ai.core.auth import DB, Staff, browser_origin
from shipping_ai.core.config import settings
from shipping_ai.models import (
    ActivityEvent,
    Company,
    CompanyMember,
    DocumentExtraction,
    GmailConnection,
    ReviewSnapshot,
    TelegramDelivery,
    TelegramRecipient,
    User,
    WorkspaceMember,
)

from . import gmail, telegram

router = APIRouter(tags=["integrations"])
mutation = [Depends(browser_origin)]
OAUTH_COOKIE = "shipping_gmail_state"


class GmailSettings(BaseModel):
    senders: list[EmailStr] = Field(max_length=50)
    company_id: UUID | None = None
    enabled: bool = False


class TelegramLink(BaseModel):
    email: EmailStr
    chat_id: Annotated[str, StringConstraints(pattern=r"^[1-9][0-9]{0,19}$")]


class PairingTokenRequest(BaseModel):
    email: EmailStr | None = None


class SendRequest(BaseModel):
    recipient_id: UUID
    revision: int
    payload_hash: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


def enabled_bot():
    token = settings().telegram_bot_token
    return bool(token and re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]+", token.get_secret_value()))


def redis_client():
    return Redis.from_url(str(settings().redis_url), socket_timeout=2)


@router.get("/integrations")
def status(db: DB, _user: Staff):
    workspace = require_workspace(db, admin=True)
    connection = db.get(GmailConnection, workspace)
    rows = db.execute(
        select(TelegramRecipient.id, TelegramRecipient.display_name, User.email)
        .join(User)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(
            TelegramRecipient.workspace_id == workspace,
            WorkspaceMember.workspace_id == workspace,
            User.active.is_(True),
        )
        .order_by(User.email, TelegramRecipient.id)
    )
    return {
        "gmail": {
            "configured": gmail.configured(),
            "connected": connection is not None,
            "enabled": connection.enabled if connection else False,
            "mailbox": connection.mailbox if connection else None,
            "senders": connection.senders if connection else [],
            "company_id": connection.company_id if connection else None,
            "last_synced_at": connection.last_synced_at if connection else None,
            "error": connection.error_code if connection else None,
        },
        "telegram": {
            "configured": enabled_bot(),
            "bot_username": telegram.bot_username() if enabled_bot() else None,
            "mini_app": settings().web_origin.scheme == "https",
            "recipients": [dict(row._mapping) for row in rows],
        },
    }


@router.post("/integrations/gmail/connect", dependencies=mutation)
def gmail_connect(db: DB, user: Staff, response: Response):
    workspace = require_workspace(db, admin=True)
    if not gmail.configured():
        raise HTTPException(503, "Gmail configuration is missing")
    if db.get(GmailConnection, workspace):
        raise HTTPException(409, "Disconnect the existing Gmail mailbox first")
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    try:
        with redis_client() as redis:
            redis.set(
                f"shipping:oauth:{state}",
                json.dumps([str(workspace), str(user.id), verifier]),
                ex=600,
            )
    except RedisError:
        raise HTTPException(503, "Could not start authorization") from None
    response.set_cookie(
        OAUTH_COOKIE,
        state,
        max_age=600,
        httponly=True,
        secure=settings().session_secure,
        samesite="lax",
        path="/",
    )
    challenge = urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    params = urlencode(
        {
            "client_id": settings().gmail_client_id,
            "scope": gmail.SCOPE,
            "redirect_uri": f"{settings().origin}{gmail.CALLBACK}",
            "response_type": "code",
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    return {"url": f"{gmail.AUTH_URL}?{params}"}


@router.get("/integrations/gmail/callback")
def gmail_callback(request: Request, db: DB, state: str = "", code: str = ""):
    cookie_state = request.cookies.get(OAUTH_COOKIE, "")
    cookie_valid = bool(cookie_state and hmac.compare_digest(state, cookie_state))
    dev_fallback = settings().environment == "development"
    if len(state) != 43 or not (cookie_valid or (dev_fallback and not cookie_state)):
        raise HTTPException(403, "Gmail authorization could not be verified")
    try:
        with redis_client() as redis:
            saved = redis.getdel(f"shipping:oauth:{state}")
    except RedisError:
        raise HTTPException(503, "Gmail authorization could not be restored") from None

    result = "connection_failed"
    if saved and code and len(code) <= 2048 and gmail.configured():
        workspace, owner, verifier = json.loads(saved)
        workspace_id, owner_id = UUID(workspace), UUID(owner)
        if not gmail.active_owner(db, workspace_id, owner_id):
            raise HTTPException(403, "Workspace administrator access required")
        try:
            with httpx.Client(timeout=8) as client:
                credential = gmail.token(
                    client,
                    code=code,
                    code_verifier=verifier,
                    grant_type="authorization_code",
                    redirect_uri=f"{settings().origin}{gmail.CALLBACK}",
                )
                profile = gmail.get(client, credential["access_token"], "profile")
            email, cursor = profile["emailAddress"], str(profile["historyId"])
            if (
                not isinstance(email, str)
                or not email
                or len(email) > 254
                or not cursor.isdigit()
                or len(cursor) > 32
            ):
                raise gmail.GmailError("gmail_profile_invalid")
            refresh = gmail.cipher().encrypt(credential["refresh_token"].encode())
            inserted = db.scalar(
                insert(GmailConnection)
                .values(
                    workspace_id=workspace_id,
                    owner_id=owner_id,
                    mailbox=email,
                    credential=refresh,
                    history_id=cursor,
                )
                .on_conflict_do_nothing(index_elements=[GmailConnection.workspace_id])
                .returning(GmailConnection.workspace_id)
            )
            db.commit()
            if inserted:
                result = "connected"
        except (gmail.GmailError, KeyError, AttributeError, TypeError):
            pass
    response = RedirectResponse(f"{settings().origin}/integrations?gmail={result}", status_code=303)
    response.delete_cookie(
        OAUTH_COOKIE,
        path="/",
        samesite="lax",
        secure=settings().session_secure,
        httponly=True,
    )
    return response


@router.post("/integrations/gmail/settings", status_code=204, dependencies=mutation)
def configure_gmail(payload: GmailSettings, db: DB, _user: Staff):
    workspace = require_workspace(db, admin=True)
    connection = db.get(GmailConnection, workspace, with_for_update=True)
    if not connection:
        raise HTTPException(409, "Connect a mailbox first")
    if payload.enabled and (not gmail.configured() or not payload.senders):
        raise HTTPException(
            422, "Provide at least one allowed sender and configure Gmail before enabling intake"
        )
    if payload.company_id:
        visible_company(db, payload.company_id)
    connection.senders = sorted({value.casefold() for value in payload.senders})
    connection.company_id = payload.company_id
    connection.enabled = payload.enabled
    db.commit()


@router.post("/integrations/gmail/disconnect", status_code=204, dependencies=mutation)
def disconnect_gmail(db: DB, _user: Staff):
    workspace = require_workspace(db, admin=True)
    db.execute(delete(GmailConnection).where(GmailConnection.workspace_id == workspace))
    db.commit()


@router.post("/integrations/telegram/recipients", status_code=201, dependencies=mutation)
def link_telegram(payload: TelegramLink, db: DB, _user: Staff):
    workspace = require_workspace(db, admin=True)
    if not enabled_bot():
        raise HTTPException(503, "Telegram bot configuration is missing")
    user = db.scalar(
        select(User)
        .join(WorkspaceMember)
        .where(
            WorkspaceMember.workspace_id == workspace,
            User.email == payload.email.casefold(),
            User.active.is_(True),
        )
    )
    if user is None:
        raise HTTPException(404, "Select an active workspace staff account")
    try:
        chat = telegram.api("getChat", {"chat_id": payload.chat_id})
    except telegram.TelegramError:
        raise HTTPException(
            422, "Chat is unavailable. The staff member must start the bot first."
        ) from None
    if chat.get("type") != "private" or str(chat.get("id")) != payload.chat_id:
        raise HTTPException(422, "Select the staff member’s private chat")
    name = " ".join(part for part in [chat.get("first_name"), chat.get("last_name")] if part)
    recipient = db.scalar(
        insert(TelegramRecipient)
        .values(
            workspace_id=workspace,
            user_id=user.id,
            chat_id=payload.chat_id,
            display_name=(name or "Private chat")[:254],
        )
        .on_conflict_do_nothing(constraint="uq_telegram_workspace_chat")
        .returning(TelegramRecipient.id)
    )
    if not recipient:
        raise HTTPException(409, "This chat is already linked")
    db.commit()
    return {"id": recipient}


@router.post(
    "/integrations/telegram/recipients/{recipient_id}/unlink",
    status_code=204,
    dependencies=mutation,
)
def unlink_telegram(recipient_id: UUID, db: DB, _user: Staff):
    workspace = require_workspace(db, admin=True)
    db.execute(
        delete(TelegramRecipient).where(
            TelegramRecipient.workspace_id == workspace, TelegramRecipient.id == recipient_id
        )
    )
    db.commit()


@router.post("/integrations/telegram/pairing-token", dependencies=mutation)
def create_pairing_token(payload: PairingTokenRequest, db: DB, user: Staff):
    workspace = require_workspace(db, admin=True)
    if not enabled_bot():
        raise HTTPException(503, "Telegram bot configuration is missing")
    target_user = user
    if payload.email:
        target_user = db.scalar(
            select(User)
            .join(WorkspaceMember)
            .where(
                WorkspaceMember.workspace_id == workspace,
                User.email == payload.email.casefold(),
                User.active.is_(True),
            )
        )
        if target_user is None:
            raise HTTPException(404, "Select an active workspace staff account")

    token = secrets.token_hex(8)
    try:
        with redis_client() as redis:
            redis.set(
                f"shipping:telegram_pair:{token}",
                json.dumps([str(workspace), str(target_user.id)]),
                ex=600,
            )
    except RedisError:
        raise HTTPException(503, "Could not create pairing session") from None

    bot_user = telegram.bot_username()
    pairing_url = f"https://t.me/{bot_user}?start=harborway_{token}" if bot_user else None
    return {
        "token": token,
        "bot_username": bot_user,
        "pairing_url": pairing_url,
        "expires_in": 600,
    }


@router.post("/integrations/telegram/sync", dependencies=mutation)
def sync_telegram(db: DB, _user: Staff):
    require_workspace(db, admin=True)
    if not enabled_bot():
        raise HTTPException(503, "Telegram bot configuration is missing")
    try:
        with redis_client() as redis:
            telegram.setup_bot_menus()
            count = telegram.sync_updates(db, redis)
            return {"processed": count}
    except RedisError:
        raise HTTPException(503, "Redis connection failed") from None


@router.post("/integrations/telegram/webhook")
async def telegram_webhook(request: Request, db: DB):
    if not enabled_bot():
        raise HTTPException(503, "Telegram bot configuration is missing")
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON payload")

    if isinstance(payload, dict):
        try:
            with redis_client() as redis:
                telegram.process_update(db, redis, payload)
        except RedisError:
            pass
    return {"ok": True}


def draft_notification(db, case):
    snapshot = db.scalar(
        select(ReviewSnapshot).where(
            ReviewSnapshot.intake_case_id == case.id,
            ReviewSnapshot.revision == case.analysis_revision,
        )
    )
    if not snapshot or case.state not in {
        "needs_review",
        "ready_for_approval",
        "approved",
        "rejected",
    }:
        raise HTTPException(409, "Wait for the current draft analysis to complete")
    payloads = db.scalars(
        select(DocumentExtraction.payload).where(DocumentExtraction.snapshot_id == snapshot.id)
    ).all()
    company = db.get(Company, case.company_id) if case.company_id else None
    review = latest_review(db, case)
    text, quick = telegram.format_summary(
        case, company.name if company else None, snapshot, payloads, review
    )
    buttons = telegram.mini_app_buttons(case, review if quick else None)
    return text, quick, buttons


def notification_hash(text, buttons):
    payload = json.dumps([text, buttons], separators=(",", ":")) if buttons else text
    return hashlib.sha256(payload.encode()).hexdigest()


def eligible_recipients(db, case):
    query = (
        select(TelegramRecipient, User.email)
        .join(User)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
    )
    query = query.where(
        TelegramRecipient.workspace_id == case.workspace_id,
        WorkspaceMember.workspace_id == case.workspace_id,
        User.active.is_(True),
    )
    operators = select(CompanyMember.user_id).where(CompanyMember.company_id == case.company_id)
    return query.where((WorkspaceMember.role == "admin") | User.id.in_(operators))


@router.get("/intakes/{case_id}/telegram")
def notification_preview(case_id: UUID, db: DB, _user: Staff):
    require_workspace(db, admin=True)
    case = visible_case(db, case_id)
    text, quick, buttons = draft_notification(db, case)
    return {
        "message": text,
        "revision": case.analysis_revision,
        "quick": quick,
        "payload_hash": notification_hash(text, buttons),
        "buttons": [button["text"] for button in buttons],
        "configured": enabled_bot(),
        "recipients": [
            {"id": recipient.id, "name": recipient.display_name, "email": email}
            for recipient, email in db.execute(eligible_recipients(db, case).order_by(User.email))
        ],
    }


@router.post("/intakes/{case_id}/telegram", dependencies=mutation)
def send_notification(case_id: UUID, request: SendRequest, db: DB, user: Staff):
    require_workspace(db, admin=True)
    if not enabled_bot():
        raise HTTPException(503, "Telegram bot configuration is missing")
    case = visible_case(db, case_id, lock=True)
    preview, _, buttons = draft_notification(db, case)
    preview_hash = notification_hash(preview, buttons)
    if request.revision != case.analysis_revision or not hmac.compare_digest(
        preview_hash, request.payload_hash
    ):
        raise HTTPException(409, "The draft changed. Review the updated message before sending.")
    recipient = db.scalar(
        eligible_recipients(db, case).where(TelegramRecipient.id == request.recipient_id)
    )
    if not recipient:
        raise HTTPException(404, "No authorized recipient found for this case")
    values = {
        "case_id": case.id,
        "revision": case.analysis_revision,
        "chat_id": recipient.chat_id,
        "payload_hash": preview_hash,
    }
    ident = db.scalar(
        insert(TelegramDelivery)
        .values(**values, actor_id=user.id, state="sending")
        .on_conflict_do_nothing(constraint="uq_telegram_delivery")
        .returning(TelegramDelivery.id)
    )
    if not ident:
        existing = db.scalar(select(TelegramDelivery).filter_by(**values))
        return {"id": existing.id, "state": existing.state}
    db.commit()  # Reserve the exact delivery before contacting Telegram.
    delivery = db.get(TelegramDelivery, ident)
    try:
        sent = telegram.api(
            "sendMessage",
            {
                "chat_id": delivery.chat_id,
                "text": preview,
                "link_preview_options": {"is_disabled": True},
                **({"reply_markup": {"inline_keyboard": [buttons]}} if buttons else {}),
            },
        )
        message_id = sent.get("message_id")
        if not isinstance(message_id, int):
            raise telegram.TelegramError()
        delivery.provider_message_id = str(message_id)
        delivery.state = "sent"
    except telegram.TelegramError as exc:
        delivery.state = "failed" if exc.definitive else "uncertain"
    db.add(
        ActivityEvent(
            actor_type="staff",
            actor_id=user.id,
            intake_case_id=case.id,
            event_type=f"telegram_{delivery.state}",
        )
    )
    db.commit()
    return {"id": ident, "state": delivery.state}


@router.get("/intakes/{case_id}/quick-approval")
def quick_preview(case_id: UUID, db: DB, _user: Staff):
    case = visible_case(db, case_id)
    message, quick, _ = draft_notification(db, case)
    review = latest_review(db, case)
    return {
        "eligible": quick,
        "message": message,
        "revision": case.analysis_revision,
        "review_id": review.id if review else None,
    }


def require_quick_decision(case_id: UUID, request: Decision, db: DB):
    case = visible_case(db, case_id, lock=True)
    review = latest_review(db, case)
    if (
        request.expected_revision != case.analysis_revision
        or not review
        or request.review_id != review.id
    ):
        raise HTTPException(409, "The draft changed. Open the current review.")
    _, quick, _ = draft_notification(db, case)
    if not quick:
        raise HTTPException(409, "This draft requires full web review.")


@router.post("/intakes/{case_id}/quick-approval", dependencies=mutation)
def quick_approve(case_id: UUID, request: Decision, db: DB, user: Staff):
    require_quick_decision(case_id, request, db)
    return approve(case_id, request, db, user)


@router.post("/intakes/{case_id}/quick-rejection", dependencies=mutation)
def quick_reject(case_id: UUID, request: Decision, db: DB, user: Staff):
    require_quick_decision(case_id, request, db)
    return reject(case_id, request, db, user)
