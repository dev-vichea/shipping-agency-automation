import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, SecretStr, field_validator
from redis import Redis, RedisError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from shipping_ai.models import StaffSession, User

from .access import WORKSPACE_COOKIE, bind_access
from .config import settings
from .db import get_db

COOKIE = "shipping_session"
PASSWORD = PasswordHasher(time_cost=2, memory_cost=32768, parallelism=2)
DUMMY_HASH = PASSWORD.hash(secrets.token_hex(32))
DB = Annotated[Session, Depends(get_db)]
router = APIRouter(prefix="/auth", tags=["staff authentication"])


class Credentials(BaseModel):
    email: EmailStr
    password: SecretStr

    @field_validator("password")
    @classmethod
    def bounded_password(cls, value: SecretStr) -> SecretStr:
        if not 1 <= len(value.get_secret_value()) <= 128:
            raise ValueError("Password must contain 1 to 128 characters")
        return value


class Preferences(BaseModel):
    approval_alerts: bool
    automation_alerts: bool


class StaffProfile(Preferences):
    email: EmailStr


def profile(user: User):
    return StaffProfile(
        email=user.email,
        approval_alerts=user.approval_alerts,
        automation_alerts=user.automation_alerts,
    )


class ChangePassword(BaseModel):
    current_password: SecretStr
    new_password: SecretStr

    @field_validator("current_password", "new_password")
    @classmethod
    def bounded(cls, value: SecretStr):
        if not 1 <= len(value.get_secret_value()) <= 128:
            raise ValueError("Password length is invalid")
        return value


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def browser_origin(request: Request) -> None:
    cfg = settings()
    allowed = {cfg.origin}
    loopback = {"localhost": "127.0.0.1", "127.0.0.1": "localhost"}
    host = cfg.web_origin.host
    if cfg.environment == "development" and host in loopback:
        allowed.add(cfg.origin.replace(f"://{host}", f"://{loopback[host]}", 1))
    if request.headers.get("origin") not in allowed:
        raise HTTPException(403, "Request origin is not allowed")


def current_staff(request: Request, db: DB) -> User:
    token = request.cookies.get(COOKIE, "")
    if len(token) == 43:
        user = db.scalar(
            select(User)
            .join(StaffSession)
            .where(
                StaffSession.token_hash == digest(token),
                StaffSession.expires_at > datetime.now(UTC),
                User.active.is_(True),
            )
        )
        if user:
            bind_access(db, user.id, request.cookies.get(WORKSPACE_COOKIE, ""))
            return user
    raise HTTPException(401, "Sign in as an active staff member")


Staff = Annotated[User, Depends(current_staff)]


def throttle(email: str) -> None:
    # Apply before the password hash. Redis errors fail closed for new logins.
    try:
        with Redis.from_url(str(settings().redis_url), socket_timeout=2) as redis:
            key = "shipping:login:" + digest(email)
            pipe = redis.pipeline()
            pipe.incr(key)
            pipe.expire(key, 60, nx=True)
            pipe.incr("shipping:login:total")
            pipe.expire("shipping:login:total", 60, nx=True)
            attempts, _, total, _ = pipe.execute()
    except RedisError:
        raise HTTPException(503, "Sign-in is temporarily unavailable") from None
    if attempts > 10 or total > 100:
        raise HTTPException(429, "Too many sign-in attempts. Try again in a minute.")


@router.post("/login", response_model=StaffProfile, dependencies=[Depends(browser_origin)])
def login(payload: Credentials, request: Request, response: Response, db: DB):
    email = payload.email.casefold()
    throttle(email)
    user = db.scalar(select(User).where(User.email == email).with_for_update())
    try:
        verified = PASSWORD.verify(
            user.password_hash if user else DUMMY_HASH, payload.password.get_secret_value()
        )
    except (VerificationError, InvalidHashError):
        verified = False
    if not verified or not user or not user.active:
        raise HTTPException(401, "Invalid email or password")

    previous = request.cookies.get(COOKIE, "")
    if len(previous) == 43:
        db.execute(delete(StaffSession).where(StaffSession.token_hash == digest(previous)))
    now = datetime.now(UTC)
    db.execute(delete(StaffSession).where(StaffSession.expires_at <= now))
    token = secrets.token_urlsafe(32)
    ttl = timedelta(hours=settings().session_hours)
    db.add(StaffSession(token_hash=digest(token), user_id=user.id, expires_at=now + ttl))
    db.commit()
    response.set_cookie(
        COOKIE,
        token,
        max_age=int(ttl.total_seconds()),
        httponly=True,
        samesite="strict",
        secure=settings().session_secure,
        path="/",
    )
    return profile(user)


@router.get("/me", response_model=StaffProfile)
def me(user: Staff):
    return profile(user)


@router.post("/logout", status_code=204, dependencies=[Depends(browser_origin)])
def logout(request: Request, response: Response, db: DB, _user: Staff) -> None:
    db.execute(
        delete(StaffSession).where(StaffSession.token_hash == digest(request.cookies[COOKIE]))
    )
    db.commit()
    response.delete_cookie(WORKSPACE_COOKIE, path="/")
    response.delete_cookie(
        COOKIE, path="/", samesite="strict", secure=settings().session_secure, httponly=True
    )


@router.post("/preferences", response_model=StaffProfile, dependencies=[Depends(browser_origin)])
def save_preferences(payload: Preferences, db: DB, user: Staff):
    user.approval_alerts = payload.approval_alerts
    user.automation_alerts = payload.automation_alerts
    db.commit()
    return profile(user)


@router.post("/password", status_code=204, dependencies=[Depends(browser_origin)])
def change_password(payload: ChangePassword, request: Request, db: DB, user: Staff):
    if (
        len(payload.new_password.get_secret_value()) < 12
        or payload.current_password == payload.new_password
    ):
        raise HTTPException(422, "Choose a new password with at least 12 characters")
    throttle(user.email)
    locked = db.get(User, user.id, with_for_update=True, populate_existing=True)
    try:
        PASSWORD.verify(locked.password_hash, payload.current_password.get_secret_value())
    except (VerificationError, InvalidHashError):
        raise HTTPException(422, "Current password is incorrect") from None
    locked.password_hash = PASSWORD.hash(payload.new_password.get_secret_value())
    db.execute(
        delete(StaffSession).where(
            StaffSession.user_id == user.id,
            StaffSession.token_hash != digest(request.cookies[COOKIE]),
        )
    )
    db.commit()
