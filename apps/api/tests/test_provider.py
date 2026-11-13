import httpx
import pytest

from shipping_ai.ai.provider import OllamaProvider
from shipping_ai.core.config import Settings


@pytest.mark.parametrize(
    ("outcome", "status"),
    [
        ("disabled", "disabled"),
        ("down", "unavailable"),
        ("invalid", "unavailable"),
        ("missing", "model_missing"),
        ("ok", "ready"),
    ],
)
def test_ollama_availability_is_optional(monkeypatch, outcome, status):
    cfg = Settings(
        database_url="postgresql+psycopg://localhost/shipping",
        redis_url="redis://localhost:6379/0",
        web_origin="http://localhost:3000",
        environment="test",
        ollama_enabled=outcome != "disabled",
    )

    def get(url, **kwargs):
        assert outcome != "disabled"
        assert url.endswith("/api/tags") and kwargs["timeout"] == 3
        if outcome == "down":
            raise httpx.ConnectError("unreachable")
        return httpx.Response(
            200,
            request=httpx.Request("GET", url),
            json={
                "models": (
                    [{"name": cfg.ollama_model}]
                    if outcome == "ok"
                    else "bad"
                    if outcome == "invalid"
                    else []
                )
            },
        )

    monkeypatch.setattr(httpx, "get", get)
    result = OllamaProvider(cfg).health()
    assert result.state == status
    assert result.context == 4096 and result.max_concurrency == 1
