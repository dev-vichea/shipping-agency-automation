from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints


def database_text(value: str) -> str:
    if "\x00" in value:
        raise ValueError("Text must not contain a null character")
    try:
        value.encode("utf-8")
    except UnicodeError:
        raise ValueError("Text must be valid UTF-8") from None
    return value


SafeText = AfterValidator(database_text)
Key = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160), SafeText
]
Label = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=254), SafeText
]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Arrival(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_message_id: Key | None = None
    thread_id: Key | None = None
    sender: Label | None = None
    subject: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=200), SafeText] | None
    ) = None
    body: Annotated[str, StringConstraints(max_length=16_000), SafeText] | None = None
    company_id: UUID | None = None
    intake_case_id: UUID | None = None
    parent_version_id: UUID | None = None
    classification: Literal["invoice", "packing_list", "draft_bl", "final_bl", "other"] = "other"


class MessageView(ORM):
    id: UUID
    channel: str
    provider_message_id: str
    thread_id: str | None
    sender: str | None
    subject: str | None
    body: str | None
    received_at: datetime


class DocumentView(ORM):
    id: UUID
    source_message_id: UUID
    parent_version_id: UUID | None
    version_number: int = 1
    original_filename: str
    classification: str
    mime: str
    sha256: str
    size_bytes: int
    received_at: datetime


class CaseSummary(ORM):
    id: UUID
    state: str
    channel: str
    company_id: UUID | None = None
    company: str | None = None
    detected_reference: str | None
    review_reason: str | None
    created_at: datetime
    updated_at: datetime
    attachment_count: int
    subject: str | None
    sender: str | None = None
    received_at: datetime | None = None
    analysis_outcome: Literal["PASS", "WARNING", "MISMATCH", "NEEDS_REVIEW"] | None = None
    review_checks: dict[str, Literal["PASS", "WARNING", "MISMATCH", "NEEDS_REVIEW"]] = Field(
        default_factory=dict
    )
    document_roles: list[str] = Field(default_factory=list)
    file_types: list[str] = Field(default_factory=list)
    issue_count: int = 0
    bill_of_lading: str | None = None


class CaseDetail(CaseSummary):
    messages: list[MessageView]
    documents: list[DocumentView]
    import_id: UUID | None
    final_bl_confirmed_revision: int | None = None


class Receipt(BaseModel):
    case_id: UUID
    run_id: UUID | None = None
    replayed: bool
