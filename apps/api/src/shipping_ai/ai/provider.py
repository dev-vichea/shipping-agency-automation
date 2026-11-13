from typing import Literal, Protocol

import httpx
from pydantic import BaseModel

from shipping_ai.core.config import Settings


class ProviderStatus(BaseModel):
    provider: str
    model: str
    state: Literal["disabled", "unavailable", "model_missing", "ready"]
    context: int
    max_concurrency: int


class ModelProvider(Protocol):
    def health(self) -> ProviderStatus: ...


class ModelTag(BaseModel):
    name: str


class ModelList(BaseModel):
    models: list[ModelTag]


class OllamaProvider:
    def __init__(self, config: Settings):
        self.config = config

    def health(self) -> ProviderStatus:
        cfg = self.config
        state = "disabled"
        if cfg.ollama_enabled:
            try:
                response = httpx.get(
                    f"{str(cfg.ollama_url).rstrip('/')}/api/tags",
                    timeout=3.0,
                    trust_env=False,
                )
                response.raise_for_status()
                models = ModelList.model_validate_json(response.content)
                state = (
                    "ready"
                    if any(tag.name == cfg.ollama_model for tag in models.models)
                    else "model_missing"
                )
            except (httpx.HTTPError, ValueError):
                state = "unavailable"
        return ProviderStatus(
            provider="ollama",
            model=cfg.ollama_model,
            state=state,
            context=cfg.ollama_context,
            max_concurrency=cfg.ollama_max_concurrency,
        )
