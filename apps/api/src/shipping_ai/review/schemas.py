from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

Outcome = Literal["PASS", "WARNING", "MISMATCH", "NEEDS_REVIEW"]
Role = Literal[
    "invoice", "packing_list", "draft_bl", "arrival_notice", "release_order",
    "freight_invoice", "debit_note", "fee_statement", "other",
]
Box = tuple[float, float, float, float]


class Evidence(BaseModel):
    document_id: UUID
    sheet: str | None = None
    cell: str | None = None
    row: int | None = None
    page: int | None = None
    line: int | None = None
    raw: str | None = None
    bbox: Box | None = None
    boxes: list[Box] = Field(default_factory=list)
    method: Literal["pdf_text", "ocr", "ocr_retry", "workbook"] | None = None
    confidence: float | None = None


class FieldCandidate(BaseModel):
    value: str
    unit: str | None = None
    currency: str | None = None
    evidence: list[Evidence] = Field(default_factory=list)


class ExtractedField(BaseModel):
    value: str | None = None
    unit: str | None = None
    currency: str | None = None
    status: Literal["present", "missing", "uncertain"] = "missing"
    evidence: list[Evidence] = Field(default_factory=list)
    alternatives: list[FieldCandidate] = Field(default_factory=list)
    review_reason: str | None = None


class Item(BaseModel):
    row: int
    fields: dict[str, ExtractedField]


class Extraction(BaseModel):
    document_id: UUID
    role: Role
    status: Literal["extracted", "partial", "unsupported_layout", "failed"]
    method: str
    sheet: str | None = None
    error: str | None = None
    fields: dict[str, ExtractedField] = Field(default_factory=dict)
    items: list[Item] = Field(default_factory=list)
    source_excerpt: list[Evidence] = Field(default_factory=list)
    document_kind: str | None = None
    sections: list["Extraction"] = Field(default_factory=list)
    recovery: list[dict[str, str | int | None]] = Field(default_factory=list)


class Finding(BaseModel):
    key: str
    group: Literal["extraction", "invoice_packing", "transport", "validation", "cdc"]
    field: str
    outcome: Outcome
    explanation: str
    evidence: list[Evidence] = Field(default_factory=list)
    left: str | None = None
    right: str | None = None


class LineComparison(BaseModel):
    invoice_row: int | None = None
    packing_row: int | None = None
    quantity_delta: str | None = None
    delta_unit: str | None = None
    outcome: Outcome


class MasterItem(BaseModel):
    row: int
    serial: str | None = None
    category: str | None = None
    description: ExtractedField
    unit: ExtractedField
    approved_quantity: ExtractedField
    approved_value: ExtractedField
    unit_price: ExtractedField
    remaining_quantity: ExtractedField
    remaining_value: ExtractedField


class MasterData(BaseModel):
    company: str
    approval_ref: str
    layout: str
    categories: list[str] = []
    items: list[MasterItem]


class MasterView(BaseModel):
    id: UUID
    source_id: UUID
    company: str
    year: int
    approval_ref: str
    layout: str
    original_filename: str
    sha256: str
    balance_as_of: date | None
    verified_by: UUID
    created_at: datetime


class Candidate(BaseModel):
    invoice_document_id: UUID
    invoice_row: int
    master_row: int
    description: str
    score: float
    evidence: Evidence


class ReviewView(BaseModel):
    revision: int
    analysis_revision: int | None = None
    state: Literal["pending", "available", "failed"]
    run_id: UUID | None = None
    trace_id: UUID | None = None
    rules_version: str | None = None
    extracted_at: datetime | None = None
    outcome: Outcome | None = None
    extractions: list[Extraction] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    line_items: list[LineComparison] = Field(default_factory=list)
    candidates: list[Candidate] = Field(default_factory=list)
    selected_master: MasterView | None = None
    analyzed_master: MasterView | None = None
    ai_state: (
        Literal["disabled", "pending", "ready", "unavailable", "invalid_output", "not_needed"]
        | None
    ) = None
    ai_model: str | None = None
    ai_prompt_version: str | None = None
    ai_trace_id: UUID | None = None
    ai_suggestions: list[dict] = Field(default_factory=list)
