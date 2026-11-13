from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .core.db import Base


class Identified:
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)


class Created:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(Identified, Created, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


class StaffSession(Base):
    __tablename__ = "staff_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class IntakeCase(Identified, Created, Base):
    __tablename__ = "intake_cases"
    __table_args__ = (
        CheckConstraint("state IN ('queued','needs_review','failed')", name="state"),
        Index("ix_intake_cases_recent", "created_at", "id"),
    )

    state: Mapped[str] = mapped_column(String(24), server_default="queued")
    channel: Mapped[str] = mapped_column(String(24))
    analysis_revision: Mapped[int] = mapped_column(Integer, server_default="0")
    cdc_master_version_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("cdc_master_versions.id"), index=True
    )
    detected_reference: Mapped[str | None] = mapped_column(String(160))
    review_reason: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class IncomingMessage(Identified, Base):
    __tablename__ = "incoming_messages"
    __table_args__ = (
        UniqueConstraint("channel", "provider_message_id", name="uq_message_channel_provider"),
        UniqueConstraint("id", "intake_case_id", name="uq_message_case"),
    )

    intake_case_id: Mapped[UUID] = mapped_column(ForeignKey("intake_cases.id"), index=True)
    channel: Mapped[str] = mapped_column(String(24))
    provider_message_id: Mapped[str] = mapped_column(String(160))
    thread_id: Mapped[str | None] = mapped_column(String(160))
    sender: Mapped[str | None] = mapped_column(String(254))
    subject: Mapped[str | None] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    payload_hash: Mapped[str] = mapped_column(String(64))
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        index=True,
    )


class ImportRecord(Identified, Created, Base):
    __tablename__ = "import_records"
    __table_args__ = (
        UniqueConstraint("id", "intake_case_id", name="uq_import_case"),
        CheckConstraint("state = 'draft'", name="phase_one_draft_only"),
        CheckConstraint(
            "(etd IS NULL AND etd_status = 'pending') OR "
            "(etd IS NOT NULL AND etd_status IN ('expected','confirmed'))",
            name="etd_status",
        ),
        CheckConstraint(
            "(eta IS NULL AND eta_status = 'pending') OR "
            "(eta IS NOT NULL AND eta_status IN ('expected','confirmed'))",
            name="eta_status",
        ),
        Index("ix_import_records_recent", "created_at", "id"),
    )

    intake_case_id: Mapped[UUID] = mapped_column(ForeignKey("intake_cases.id"), unique=True)
    company_id: Mapped[UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    invoice_no: Mapped[str] = mapped_column(String(160), index=True)
    supplier: Mapped[str | None] = mapped_column(String(254))
    consignee: Mapped[str | None] = mapped_column(String(254))
    state: Mapped[str] = mapped_column(String(24), server_default="draft")
    etd: Mapped[date | None] = mapped_column(Date)
    eta: Mapped[date | None] = mapped_column(Date)
    etd_status: Mapped[str] = mapped_column(String(16), server_default="pending")
    eta_status: Mapped[str] = mapped_column(String(16), server_default="pending")


class Company(Identified, Created, Base):
    __tablename__ = "companies"

    name: Mapped[str] = mapped_column(String(254))
    identity_key: Mapped[str] = mapped_column(String(254), unique=True)


class Document(Identified, Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("source_message_id", "sha256", name="uq_document_message_hash"),
        UniqueConstraint("id", "intake_case_id", name="uq_document_case"),
        ForeignKeyConstraint(
            ["source_message_id", "intake_case_id"],
            ["incoming_messages.id", "incoming_messages.intake_case_id"],
        ),
        ForeignKeyConstraint(
            ["parent_version_id", "intake_case_id"],
            ["documents.id", "documents.intake_case_id"],
        ),
        ForeignKeyConstraint(
            ["import_record_id", "intake_case_id"],
            ["import_records.id", "import_records.intake_case_id"],
        ),
        CheckConstraint(
            "classification IN ('invoice','packing_list','draft_bl','other')",
            name="classification",
        ),
        CheckConstraint("size_bytes > 0", name="size"),
    )

    intake_case_id: Mapped[UUID] = mapped_column(ForeignKey("intake_cases.id"), index=True)
    source_message_id: Mapped[UUID] = mapped_column(index=True)
    import_record_id: Mapped[UUID | None] = mapped_column(index=True)
    parent_version_id: Mapped[UUID | None] = mapped_column(index=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(96))
    classification: Mapped[str] = mapped_column(String(24), server_default="other")
    sha256: Mapped[str] = mapped_column(String(64))
    storage_key: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    is_generated: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))


class ImportItem(Identified, Base):
    __tablename__ = "import_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["import_id", "intake_case_id"],
            ["import_records.id", "import_records.intake_case_id"],
        ),
        ForeignKeyConstraint(
            ["source_document_id", "intake_case_id"],
            ["documents.id", "documents.intake_case_id"],
        ),
        UniqueConstraint("import_id", "line_no", name="uq_import_item_line"),
        CheckConstraint("line_no > 0", name="line_no"),
        CheckConstraint("quantity IS NULL OR unit IS NOT NULL", name="quantity_unit"),
        CheckConstraint(
            "(amount IS NULL AND unit_price IS NULL) OR currency IS NOT NULL", name="currency"
        ),
    )

    import_id: Mapped[UUID] = mapped_column()
    intake_case_id: Mapped[UUID] = mapped_column()
    line_no: Mapped[int] = mapped_column(Integer)
    source_document_id: Mapped[UUID | None] = mapped_column(index=True)
    source_locator: Mapped[str | None] = mapped_column(String(255))
    raw_description: Mapped[str] = mapped_column(Text)
    normalized_description: Mapped[str | None] = mapped_column(Text)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    unit: Mapped[str | None] = mapped_column(String(32))
    currency: Mapped[str | None] = mapped_column(String(3))
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(20, 6))
    verification_state: Mapped[str] = mapped_column(String(24), server_default="pending")


class AutomationRun(Identified, Created, Base):
    __tablename__ = "automation_runs"
    __table_args__ = (
        CheckConstraint("stage IN ('receipt','health_check','analysis','ai')", name="stage"),
        CheckConstraint("state IN ('queued','running','succeeded','failed')", name="state"),
        CheckConstraint("attempt >= 0 AND retry_count >= 0", name="attempt"),
        Index("ix_automation_runs_recent", "created_at", "id"),
        Index("ix_automation_runs_due", "state", "available_at"),
        Index("ix_automation_runs_lease", "state", "lease_until"),
    )

    event_key: Mapped[str] = mapped_column(String(100), unique=True)
    stage: Mapped[str] = mapped_column(String(24))
    state: Mapped[str] = mapped_column(String(24), server_default="queued")
    intake_case_id: Mapped[UUID | None] = mapped_column(ForeignKey("intake_cases.id"), index=True)
    message_id: Mapped[UUID | None] = mapped_column(ForeignKey("incoming_messages.id"), index=True)
    input_revision: Mapped[int | None] = mapped_column(Integer)
    trace_id: Mapped[UUID] = mapped_column(default=uuid4, unique=True)
    attempt: Mapped[int] = mapped_column(Integer, server_default="0")
    retry_count: Mapped[int] = mapped_column(Integer, server_default="0")
    available_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(48))


class ActivityEvent(Identified, Created, Base):
    __tablename__ = "activity_events"
    __table_args__ = (CheckConstraint("actor_type IN ('staff','worker')", name="actor_type"),)

    actor_type: Mapped[str] = mapped_column(String(16))
    actor_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), index=True)
    intake_case_id: Mapped[UUID | None] = mapped_column(ForeignKey("intake_cases.id"), index=True)
    import_record_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("import_records.id"), index=True
    )
    automation_run_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("automation_runs.id"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(48))
    before_state: Mapped[str | None] = mapped_column(String(24))
    after_state: Mapped[str | None] = mapped_column(String(24))


class CdcMasterVersion(Identified, Created, Base):
    __tablename__ = "cdc_master_versions"
    __table_args__ = (
        UniqueConstraint("company_key", "year", "approval_ref", "sha256", name="uq_cdc_version"),
        CheckConstraint("year BETWEEN 2000 AND 2100", name="year"),
    )

    company: Mapped[str] = mapped_column(String(254))
    company_key: Mapped[str] = mapped_column(String(254))
    year: Mapped[int] = mapped_column(Integer)
    approval_ref: Mapped[str] = mapped_column(String(160))
    layout: Mapped[str] = mapped_column(String(40))
    source_id: Mapped[UUID] = mapped_column(default=uuid4, unique=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    balance_as_of: Mapped[date | None] = mapped_column(Date)
    verified_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"), index=True)
    items: Mapped[list] = mapped_column(JSONB)


class ReviewSnapshot(Identified, Created, Base):
    __tablename__ = "review_snapshots"
    __table_args__ = (
        UniqueConstraint("intake_case_id", "revision", name="uq_case_review_revision"),
        CheckConstraint("outcome IN ('PASS','WARNING','MISMATCH','NEEDS_REVIEW')", name="outcome"),
        CheckConstraint(
            "ai_state IN ('disabled','pending','ready','unavailable','invalid_output','not_needed')",
            name="ai_state",
        ),
    )

    intake_case_id: Mapped[UUID] = mapped_column(ForeignKey("intake_cases.id"))
    revision: Mapped[int] = mapped_column(Integer)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("automation_runs.id"), unique=True)
    cdc_master_version_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("cdc_master_versions.id"), index=True
    )
    rules_version: Mapped[str] = mapped_column(String(32))
    outcome: Mapped[str] = mapped_column(String(24))
    findings: Mapped[list] = mapped_column(JSONB)
    candidates: Mapped[list] = mapped_column(JSONB)
    ai_state: Mapped[str] = mapped_column(String(24))
    ai_model: Mapped[str | None] = mapped_column(String(120))
    ai_prompt_version: Mapped[str | None] = mapped_column(String(32))
    ai_trace_id: Mapped[UUID | None] = mapped_column()
    ai_suggestions: Mapped[list] = mapped_column(JSONB, default=list)


class DocumentExtraction(Identified, Created, Base):
    __tablename__ = "document_extractions"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "document_id", "role", name="uq_snapshot_document_role"),
    )

    snapshot_id: Mapped[UUID] = mapped_column(ForeignKey("review_snapshots.id"))
    document_id: Mapped[UUID] = mapped_column(ForeignKey("documents.id"), index=True)
    role: Mapped[str] = mapped_column(String(24))
    status: Mapped[str] = mapped_column(String(24))
    payload: Mapped[dict] = mapped_column(JSONB)
