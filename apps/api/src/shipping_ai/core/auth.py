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


class StaffProfile(BaseModel):
    email: EmailStr


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def browser_origin(request: Request) -> None:
    if request.headers.get("origin") != settings().origin:
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
    user = db.scalar(select(User).where(User.email == email))
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
    return StaffProfile(email=user.email)


@router.get("/me", response_model=StaffProfile)
def me(user: Staff):
    return StaffProfile(email=user.email)


@router.post("/logout", status_code=204, dependencies=[Depends(browser_origin)])
def logout(request: Request, response: Response, db: DB, _user: Staff) -> None:
    db.execute(
        delete(StaffSession).where(StaffSession.token_hash == digest(request.cookies[COOKIE]))
    )
    db.commit()
    response.delete_cookie(
        COOKIE, path="/", samesite="strict", secure=settings().session_secure, httponly=True
    )
