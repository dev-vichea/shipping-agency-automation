import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

from alembic import command

API = Path(__file__).resolve().parents[1]
ORIGIN = "http://localhost:3000"
PASSWORD = "synthetic-test-password"


@pytest.fixture(scope="session")
def integration_database(tmp_path_factory):
    database = os.environ.get("TEST_DATABASE_URL")
    redis = os.environ.get("TEST_REDIS_URL")
    if not database or not redis:
        pytest.skip("Set TEST_DATABASE_URL and TEST_REDIS_URL for PostgreSQL integration tests")
    db_name = f"shipping_test_{uuid4().hex}"
    admin = create_engine(database, isolation_level="AUTOCOMMIT", hide_parameters=True)
    with admin.connect() as conn:
        conn.exec_driver_sql(f"CREATE DATABASE {db_name}")

    with pytest.MonkeyPatch.context() as env:
        env.setenv(
            "SHIPPING_DATABASE_URL",
            make_url(database).set(database=db_name).render_as_string(hide_password=False),
        )
        env.setenv("SHIPPING_REDIS_URL", redis)
        env.setenv("SHIPPING_WEB_ORIGIN", ORIGIN)
        env.setenv("SHIPPING_ENVIRONMENT", "test")
        env.setenv("SHIPPING_SESSION_SECURE", "false")
        env.setenv("SHIPPING_MAX_FILE_BYTES", "8192")
        env.setenv("SHIPPING_STORAGE_DIR", str(tmp_path_factory.mktemp("originals")))
        env.setenv("SHIPPING_OLLAMA_ENABLED", "false")
        from shipping_ai.core.config import settings
        from shipping_ai.core.db import engine, session_factory

        try:
            command.upgrade(Config(str(API / "alembic.ini")), "head")
            yield
        finally:
            session_factory.cache_clear()
            engine().dispose()
            engine.cache_clear()
            settings.cache_clear()
            with admin.connect() as conn:
                conn.exec_driver_sql(f"DROP DATABASE {db_name} WITH (FORCE)")
            admin.dispose()


@pytest.fixture
def api(integration_database):
    from shipping_ai.main import app

    with TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN}) as client:
        yield client


@pytest.fixture
def staff(api):
    from shipping_ai.core.auth import PASSWORD as hasher
    from shipping_ai.core.db import session_factory
    from shipping_ai.models import User

    email = f"test-{uuid4().hex}@example.com"
    with session_factory().begin() as db:
        db.add(User(email=email, password_hash=hasher.hash(PASSWORD)))
    response = api.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    assert "HttpOnly" in response.headers["set-cookie"]
    return api
