from __future__ import annotations

import json
import logging
from typing import Literal
import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from shipping_ai.core.config import settings

logger = logging.getLogger("shipping_ai.ai.transport")


class TransportAnalysis(BaseModel):
    model_config = ConfigDict(extra="ignore")

    route_legs: Literal["2_legs", "3_legs"] = Field(
        default="2_legs",
        description="2_legs for direct ocean/air (origin -> destination port), 3_legs for multimodal/truck (origin -> border checkpoint -> final destination)",
    )
    transport_mode: Literal["BY SEA", "BY TRUCK", "BY AIR", "MULTIMODAL"] = Field(
        default="BY SEA",
        description="Primary transport mode",
    )
    origin: str | None = Field(default=None, description="Place of loading / origin port")
    port_or_border: str | None = Field(
        default=None,
        description="Entry seaport, airport, or Cambodian border checkpoint (e.g. SIHANOUKVILLE, Prey Vor border, Bavet border)",
    )
    destination: str | None = Field(
        default=None,
        description="Final destination city or delivery place (e.g. SIHANOUKVILLE, Phnom Penh, Cambodia)",
    )
    container: str | None = Field(
        default=None,
        description="Container identifier or composite size (e.g. TCNU5031571 / 1x40HC, 1x45HQ)",
    )
    seal: str | None = Field(default=None, description="Container seal number")
    explanation: str | None = Field(
        default=None,
        description="Brief logistics routing summary",
    )


def baseline_analysis_from_meta(meta: dict | None) -> TransportAnalysis:
    """Build a deterministic baseline TransportAnalysis from bill_extractor metadata."""
    if not meta:
        return TransportAnalysis()

    orig = meta.get("origin") or None
    port = meta.get("port") or None
    dest = meta.get("destination") or None
    mode = meta.get("shipping_mode") or "BY SEA"
    container = meta.get("container") or None
    c_type = meta.get("container_type") or None
    seal = meta.get("seal") or None

    if container and c_type and c_type not in container:
        container = f"{container} / {c_type}"
    elif not container and c_type:
        container = c_type

    route_legs: Literal["2_legs", "3_legs"] = "2_legs"
    p_str = (port or "").strip().upper()
    d_str = (dest or "").strip().upper()

    # Determine 3-legs vs 2-legs
    if p_str and d_str and p_str != d_str and not ("SIHANOUK" in p_str and "SIHANOUK" in d_str):
        route_legs = "3_legs"
    elif any(b in p_str for b in ["PREY VOR", "BAVET", "POIPET", "CHAM YEAM", "TRAPEANG"]):
        route_legs = "3_legs"
    elif mode == "BY TRUCK" and (p_str or d_str):
        route_legs = "3_legs"

    t_mode: Literal["BY SEA", "BY TRUCK", "BY AIR", "MULTIMODAL"] = "BY SEA"
    if mode in {"BY TRUCK", "BY AIR", "MULTIMODAL"}:
        t_mode = mode
    elif route_legs == "3_legs" and mode != "BY TRUCK":
        t_mode = "MULTIMODAL"

    expl = (
        f"3-leg route via {port} to {dest}"
        if route_legs == "3_legs" and port and dest
        else f"Direct route to {port or dest or 'Cambodia'}"
    )

    return TransportAnalysis(
        route_legs=route_legs,
        transport_mode=t_mode,
        origin=orig,
        port_or_border=port,
        destination=dest,
        container=container,
        seal=seal,
        explanation=expl,
    )


def analyze_transport(
    text: str, filename: str = "", rule_meta: dict | None = None
) -> TransportAnalysis:
    """Analyze transport route and containers using AI with deterministic fallback.

    Adheres strictly to AGENTS.md:
    - Ollama is optional, swappable, and schema-validated.
    - Deterministic baseline ensures 100% availability even when Ollama is offline.
    """
    baseline = baseline_analysis_from_meta(rule_meta)
    try:
        cfg = settings()
    except Exception:
        return baseline

    if not cfg.ollama_enabled or not text or len(text.strip()) < 40:
        return baseline

    try:
        prompt = (
            "Analyze the transport routing, border crossing, and container info from this bill of lading.\n"
            "Identify if the shipment is 2_legs (direct ocean to Sihanoukville) or 3_legs (multimodal/truck via Prey Vor or Bavet to Phnom Penh).\n"
            f"Document excerpt:\n{text[:2500]}"
        )
        response = httpx.post(
            f"{str(cfg.ollama_url).rstrip('/')}/api/generate",
            json={
                "model": cfg.ollama_model,
                "stream": False,
                "format": TransportAnalysis.model_json_schema(),
                "options": {
                    "num_ctx": cfg.ollama_context,
                    "num_predict": 280,
                    "temperature": 0,
                },
                "system": (
                    "You are a shipping logistics assistant for Cambodian customs documentation. "
                    "Extract origin, port_or_border, destination, route_legs, container, and seal. "
                    "Output JSON matching the schema strictly."
                ),
                "prompt": prompt,
            },
            timeout=httpx.Timeout(8.0, connect=2.0),
            trust_env=False,
        )
        if response.status_code == 200:
            payload = response.json()
            raw_ai = payload.get("response", "{}")
            ai_result = TransportAnalysis.model_validate_json(raw_ai)

            # Safely merge: prioritize validated AI data if present, retain deterministic rule data if AI is empty
            return TransportAnalysis(
                route_legs=ai_result.route_legs or baseline.route_legs,
                transport_mode=ai_result.transport_mode or baseline.transport_mode,
                origin=ai_result.origin or baseline.origin,
                port_or_border=ai_result.port_or_border or baseline.port_or_border,
                destination=ai_result.destination or baseline.destination,
                container=ai_result.container or baseline.container,
                seal=ai_result.seal or baseline.seal,
                explanation=ai_result.explanation or baseline.explanation,
            )
    except (httpx.HTTPError, ValidationError, ValueError, KeyError) as exc:
        logger.debug("Ollama transport analysis fallback to rule engine: %s", exc)

    return baseline
