"""document review and CDC versions

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cdc_master_versions",
        sa.Column("company", sa.String(length=254), nullable=False),
        sa.Column("company_key", sa.String(length=254), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("approval_ref", sa.String(length=160), nullable=False),
        sa.Column("layout", sa.String(length=40), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("balance_as_of", sa.Date(), nullable=True),
        sa.Column("verified_by", sa.Uuid(), nullable=False),
        sa.Column("items", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("year BETWEEN 2000 AND 2100", name=op.f("ck_cdc_master_versions_year")),
        sa.ForeignKeyConstraint(
            ["verified_by"], ["users.id"], name=op.f("fk_cdc_master_versions_verified_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cdc_master_versions")),
        sa.UniqueConstraint("company_key", "year", "approval_ref", "sha256", name="uq_cdc_version"),
        sa.UniqueConstraint("source_id", name=op.f("uq_cdc_master_versions_source_id")),
    )
    op.create_index(
        op.f("ix_cdc_master_versions_verified_by"),
        "cdc_master_versions",
        ["verified_by"],
        unique=False,
    )
    op.create_table(
        "review_snapshots",
        sa.Column("intake_case_id", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("cdc_master_version_id", sa.Uuid(), nullable=True),
        sa.Column("rules_version", sa.String(length=32), nullable=False),
        sa.Column("outcome", sa.String(length=24), nullable=False),
        sa.Column("findings", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("candidates", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("ai_state", sa.String(length=24), nullable=False),
        sa.Column("ai_model", sa.String(length=120), nullable=True),
        sa.Column("ai_prompt_version", sa.String(length=32), nullable=True),
        sa.Column("ai_trace_id", sa.Uuid(), nullable=True),
        sa.Column("ai_suggestions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "ai_state IN ('disabled','pending','ready','unavailable','invalid_output','not_needed')",
            name=op.f("ck_review_snapshots_ai_state"),
        ),
        sa.CheckConstraint(
            "outcome IN ('PASS','WARNING','MISMATCH','NEEDS_REVIEW')",
            name=op.f("ck_review_snapshots_outcome"),
        ),
        sa.ForeignKeyConstraint(
            ["cdc_master_version_id"],
            ["cdc_master_versions.id"],
            name=op.f("fk_review_snapshots_cdc_master_version_id_cdc_master_versions"),
        ),
        sa.ForeignKeyConstraint(
            ["intake_case_id"],
            ["intake_cases.id"],
            name=op.f("fk_review_snapshots_intake_case_id_intake_cases"),
        ),
        sa.ForeignKeyConstraint(
            ["run_id"],
            ["automation_runs.id"],
            name=op.f("fk_review_snapshots_run_id_automation_runs"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_review_snapshots")),
        sa.UniqueConstraint("intake_case_id", "revision", name="uq_case_review_revision"),
        sa.UniqueConstraint("run_id", name=op.f("uq_review_snapshots_run_id")),
    )
    op.create_index(
        op.f("ix_review_snapshots_cdc_master_version_id"),
        "review_snapshots",
        ["cdc_master_version_id"],
        unique=False,
    )
    op.create_table(
        "document_extractions",
        sa.Column("snapshot_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name=op.f("fk_document_extractions_document_id_documents"),
        ),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["review_snapshots.id"],
            name=op.f("fk_document_extractions_snapshot_id_review_snapshots"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_document_extractions")),
        sa.UniqueConstraint("snapshot_id", "document_id", "role", name="uq_snapshot_document_role"),
    )
    op.create_index(
        op.f("ix_document_extractions_document_id"),
        "document_extractions",
        ["document_id"],
        unique=False,
    )
    op.add_column("automation_runs", sa.Column("input_revision", sa.Integer(), nullable=True))
    op.add_column(
        "intake_cases",
        sa.Column("analysis_revision", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("intake_cases", sa.Column("cdc_master_version_id", sa.Uuid(), nullable=True))
    op.create_index(
        op.f("ix_intake_cases_cdc_master_version_id"),
        "intake_cases",
        ["cdc_master_version_id"],
        unique=False,
    )
    op.create_foreign_key(
        op.f("fk_intake_cases_cdc_master_version_id_cdc_master_versions"),
        "intake_cases",
        "cdc_master_versions",
        ["cdc_master_version_id"],
        ["id"],
    )
    op.drop_constraint(op.f("ck_automation_runs_stage"), "automation_runs", type_="check")
    op.create_check_constraint(
        op.f("ck_automation_runs_stage"),
        "automation_runs",
        "stage IN ('receipt','health_check','analysis','ai')",
    )
    # Existing cases receive one review revision. Original receipt history remains intact.
    op.execute("""
        UPDATE intake_cases SET analysis_revision = 1, state = 'queued', review_reason = NULL
    """)
    op.execute("""
        INSERT INTO automation_runs (id, event_key, stage, intake_case_id, input_revision, trace_id)
        SELECT gen_random_uuid(), 'analysis:' || id || chr(58) || '1', 'analysis', id, 1, gen_random_uuid()
        FROM intake_cases
    """)


def downgrade() -> None:
    op.drop_table("document_extractions")
    op.drop_table("review_snapshots")
    op.drop_constraint(
        op.f("fk_intake_cases_cdc_master_version_id_cdc_master_versions"),
        "intake_cases",
        type_="foreignkey",
    )
    op.drop_index(op.f("ix_intake_cases_cdc_master_version_id"), table_name="intake_cases")
    op.drop_column("intake_cases", "cdc_master_version_id")
    op.drop_column("intake_cases", "analysis_revision")
    op.execute(
        "DELETE FROM activity_events WHERE automation_run_id IN (SELECT id FROM automation_runs WHERE stage IN ('analysis','ai'))"
    )
    op.execute("DELETE FROM automation_runs WHERE stage IN ('analysis','ai')")
    op.drop_constraint(op.f("ck_automation_runs_stage"), "automation_runs", type_="check")
    op.create_check_constraint(
        op.f("ck_automation_runs_stage"), "automation_runs", "stage IN ('receipt','health_check')"
    )
    op.drop_column("automation_runs", "input_revision")
    op.drop_index(op.f("ix_cdc_master_versions_verified_by"), table_name="cdc_master_versions")
    op.drop_table("cdc_master_versions")
