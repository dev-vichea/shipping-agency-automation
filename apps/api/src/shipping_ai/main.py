from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from redis import Redis, RedisError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from .ai.provider import ModelProvider, OllamaProvider, ProviderStatus
from .automation.routes import router as automation_router
from .cdc.routes import router as cdc_router
from .core.auth import Staff
from .core.auth import router as auth_router
from .core.config import settings
from .core.db import engine
from .core.http import PrivateAPI
from .documents.routes import router as documents_router
from .imports.routes import router as imports_router
from .intakes.routes import router as intakes_router
from .review.routes import router as review_router


def create_app() -> FastAPI:
    cfg = settings()
    dev = cfg.environment != "production"
    app = FastAPI(
        title="Shipping Agency Automation API",
        version="0.2.0",
        docs_url="/docs" if dev else None,
        redoc_url=None,
        openapi_url="/openapi.json" if dev else None,
    )
    app.add_middleware(PrivateAPI)
    api = APIRouter(prefix="/api/v1")
    for router in (
        auth_router,
        intakes_router,
        imports_router,
        documents_router,
        automation_router,
        cdc_router,
        review_router,
    ):
        api.include_router(router)

    @api.get("/automation/provider", response_model=ProviderStatus, tags=["automation"])
    def model_status(_user: Staff):
        provider: ModelProvider = OllamaProvider(cfg)
        return provider.health()

    app.include_router(api)

    @app.exception_handler(RequestValidationError)
    async def bad_input(_request: Request, _exc: RequestValidationError):
        # Avoid reflecting passwords, document fields or validation internals.
        return JSONResponse({"detail": "Invalid request data"}, status_code=422)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(_request: Request, _exc: SQLAlchemyError):
        return JSONResponse({"detail": "Database request could not be completed"}, status_code=503)

    @app.get("/health/live", tags=["health"])
    def live():
        return {"status": "ok"}

    @app.get("/health/ready", tags=["health"])
    def ready():
        try:
            with engine().connect() as connection:
                if connection.scalar(text("SELECT version_num FROM alembic_version")) != "0002":
                    return JSONResponse({"status": "unavailable"}, status_code=503)
            with Redis.from_url(str(cfg.redis_url), socket_timeout=2) as redis:
                redis.ping()
        except (SQLAlchemyError, RedisError):
            return JSONResponse({"status": "unavailable"}, status_code=503)
        return {"status": "ready"}

    return app


app = create_app()
