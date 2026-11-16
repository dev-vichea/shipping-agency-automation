"""Persisted investigation data and the model's restricted decision format."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from shipping_ai.review.schemas import ExtractedField

OBJECTIVE = "Investigate the draft B/L package count against the packing list."
PROMPT_VERSION = "bl-packages-3"
Tool = Literal[
    "inspect_source_evidence",
    "extract_pdf_text",
    "ocr_pdf_region",
    "compare_document_fields",
    "request_staff_review",
]
Reason = Literal[
    "source_counts_agree",
    "source_counts_differ",
    "insufficient_evidence",
    "staff_review_requested",
    "invalid_model_output",
    "unauthorized_tool",
    "model_unavailable",
    "iteration_limit",
    "time_limit",
    "archive_unavailable",
    "archive_checksum_mismatch",
    "unreadable_pdf",
    "unsupported_pdf",
    "ocr_unavailable",
    "ocr_timeout",
    "worker_retries_exhausted",
    "revision_superseded",
]
Box = tuple[float, float, float, float]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Decision(StrictModel):
    tool: Tool
    profile: Literal["scan", "focused"] | None = None


class ToolSelection(StrictModel):
    tool: Tool


class Source(StrictModel):
    document_id: UUID
    sha256: str
    parent_version_id: UUID | None
    method: str
    extracted: ExtractedField


class Observation(StrictModel):
    page: int
    bbox: Box
    method: Literal["pdf_text", "ocr_scan", "ocr_focused"]
    raw: str
    value: str
    confidence: float | None = None


class StepResult(StrictModel):
    packing: Source | None = None
    bill: Source | None = None
    observations: list[Observation] = Field(default_factory=list)
    ambiguous: bool = False
    outcome: Literal["PASS", "MISMATCH", "NEEDS_REVIEW"] | None = None
    proposal: Observation | None = None


class Step(StrictModel):
    number: int
    decision: Decision
    started_at: datetime
    selected_attempt: int
    completed_attempt: int | None = None
    finished_at: datetime | None = None
    error: Reason | None = None
    result: StepResult | None = None


class Investigation(StrictModel):
    objective: str = OBJECTIVE
    status: Literal["pending", "running", "verified_proposal", "needs_review", "superseded"] = (
        "pending"
    )
    model: str | None
    prompt_version: str = PROMPT_VERSION
    steps: list[Step] = Field(default_factory=list)
    reason: Reason | None = None
    proposal: Observation | None = None
    requires_staff_review: bool = True
