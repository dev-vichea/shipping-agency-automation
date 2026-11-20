"""Immutable per-finding decisions pinned to the exact analysis and staff review.

Revision ID: 0012
Revises: 0011
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "intake_cases", sa.Column("final_bl_confirmed_revision", sa.Integer(), nullable=True)
    )
    op.add_column(
        "cdc_master_versions",
        sa.Column("import_key", sa.String(64), server_default="auto", nullable=False),
    )
    op.add_column("cdc_master_versions", sa.Column("import_config", JSONB(), nullable=True))
    op.drop_constraint("uq_cdc_version", "cdc_master_versions", type_="unique")
    op.create_unique_constraint(
        "uq_cdc_version",
        "cdc_master_versions",
        ["workspace_id", "company_key", "year", "approval_ref", "sha256", "import_key"],
    )
    op.create_table(
        "review_finding_decisions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("snapshot_id", sa.UUID(), sa.ForeignKey("review_snapshots.id"), nullable=False),
        sa.Column("staff_review_id", sa.UUID(), sa.ForeignKey("staff_reviews.id"), nullable=False),
        sa.Column("actor_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("finding_key", sa.String(160), nullable=False),
        sa.Column("decision", sa.String(16), nullable=False),
        sa.Column("payload", JSONB(), nullable=False),
        sa.UniqueConstraint("staff_review_id", "finding_key", name="uq_review_finding_decision"),
        sa.CheckConstraint(
            "decision IN ('approved','rejected','unresolved')",
            name=op.f("ck_review_finding_decisions_decision"),
        ),
    )
    for column in ("snapshot_id", "staff_review_id", "actor_id"):
        op.create_index(
            f"ix_review_finding_decisions_{column}", "review_finding_decisions", [column]
        )


def downgrade():
    op.drop_column("intake_cases", "final_bl_confirmed_revision")
    op.drop_table("review_finding_decisions")
    op.drop_constraint("uq_cdc_version", "cdc_master_versions", type_="unique")
    op.create_unique_constraint(
        "uq_cdc_version",
        "cdc_master_versions",
        ["workspace_id", "company_key", "year", "approval_ref", "sha256"],
    )
    op.drop_column("cdc_master_versions", "import_config")
    op.drop_column("cdc_master_versions", "import_key")
