from starlette.exceptions import HTTPException
from starlette.formparsers import MultiPartException
from starlette.responses import JSONResponse

from .config import settings


class PrivateAPI:
    """Bound bodies before form spooling and disable caching of internal data."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return

        upload = scope["path"] in {"/api/v1/intakes/simulate", "/api/v1/cdc/versions"}
        cfg = settings()
        limit = cfg.max_file_bytes * cfg.max_files + 128 * 1024 if upload else 64 * 1024
        consumed = 0
        exceeded = False

        async def bounded_receive():
            nonlocal consumed, exceeded
            message = await receive()
            if message["type"] == "http.request":
                consumed += len(message.get("body", b""))
                if consumed > limit:
                    exceeded = True
                    if upload:
                        raise MultiPartException("Upload exceeds request limit")
                    raise HTTPException(413, "Request exceeds size limit")
            return message

        async def private_send(message):
            if message["type"] == "http.response.start":
                message["headers"] = [
                    (k, v) for k, v in message["headers"] if k.lower() != b"cache-control"
                ] + [(b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff")]
            await send(message)

        async def enforce_status(message):
            if exceeded:
                if message["type"] == "http.response.start":
                    await JSONResponse({"detail": "Request exceeds size limit"}, 413)(
                        scope, receive, private_send
                    )
            else:
                await private_send(message)

        content_lengths = [v for k, v in scope["headers"] if k.lower() == b"content-length"]
        if content_lengths:
            try:
                if len(content_lengths) != 1 or not content_lengths[0].isdigit():
                    raise ValueError
                too_large = int(content_lengths[0]) > limit
            except ValueError:
                await JSONResponse({"detail": "Invalid Content-Length"}, 400)(
                    scope, receive, private_send
                )
                return
            if too_large:
                await JSONResponse({"detail": "Request exceeds size limit"}, 413)(
                    scope, receive, private_send
                )
                return
        await self.app(scope, bounded_receive, enforce_status)
