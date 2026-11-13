from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints


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
    intake_case_id: UUID | None = None
    parent_version_id: UUID | None = None
    classification: Literal["invoice", "packing_list", "draft_bl", "other"] = "other"


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
    detected_reference: str | None
    review_reason: str | None
    created_at: datetime
    updated_at: datetime
    attachment_count: int
    subject: str | None


class CaseDetail(CaseSummary):
    messages: list[MessageView]
    documents: list[DocumentView]
    import_id: UUID | None


class Receipt(BaseModel):
    case_id: UUID
    run_id: UUID
    replayed: bool
