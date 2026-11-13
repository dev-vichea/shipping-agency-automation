from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AnyHttpUrl, Field, PostgresDsn, RedisDsn, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="SHIPPING_", extra="ignore", hide_input_in_errors=True
    )

    environment: Literal["development", "test", "production"] = "production"
    database_url: PostgresDsn
    redis_url: RedisDsn
    web_origin: AnyHttpUrl
    storage_dir: Path = Path("/var/lib/shipping/documents")
    session_secure: bool = True
    session_hours: int = Field(default=8, ge=1, le=24)
    max_file_bytes: int = Field(default=10 * 1024**2, ge=1024, le=20 * 1024**2)
    max_files: int = Field(default=5, ge=1, le=5)
    ollama_enabled: bool = False
    ollama_url: AnyHttpUrl = AnyHttpUrl("http://127.0.0.1:11434")
    ollama_model: str = Field(default="qwen3.5:4b-q4_K_M", min_length=1, max_length=120)
    ollama_context: int = Field(default=4096, ge=1024, le=4096)
    ollama_max_concurrency: int = Field(default=1, ge=1, le=1)

    @model_validator(mode="after")
    def validate_origin(self):
        url = self.web_origin
        if url.username or url.password or url.path not in (None, "/") or url.query or url.fragment:
            raise ValueError("web_origin must contain only scheme, host and optional port")
        if self.environment == "production" and (not self.session_secure or url.scheme != "https"):
            raise ValueError("Production sessions require HTTPS and secure cookies")
        if self.ollama_enabled:
            endpoint = self.ollama_url
            if (
                endpoint.host not in {"localhost", "127.0.0.1", "[::1]", "host.docker.internal"}
                or endpoint.username
                or endpoint.password
                or endpoint.query
                or endpoint.fragment
                or endpoint.path not in (None, "/")
            ):
                raise ValueError("Ollama generation requires a local or Docker host endpoint")
            if self.ollama_model.endswith(("-cloud", ":cloud")):
                raise ValueError("Ollama generation requires a locally installed model")
        return self

    @property
    def origin(self) -> str:
        return str(self.web_origin).rstrip("/")


@lru_cache
def settings() -> Settings:
    return Settings()
