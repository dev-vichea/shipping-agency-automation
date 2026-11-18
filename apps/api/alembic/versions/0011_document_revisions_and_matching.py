"""document revision tracking, multi-identifier matching and final BL

Revision ID: 0011
Revises: 0010
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

NEW_CASE_STATES = (
    "state IN ('queued','needs_review','ready_for_approval','approved','rejected','failed','awaiting_updated_document','manual_matching')"
)
OLD_CASE_STATES = (
    "state IN ('queued','needs_review','ready_for_approval','approved','rejected','failed')"
)

NEW_CLASSIFICATIONS = (
    "classification IN ('invoice','packing_list','draft_bl','final_bl','other')"
)
OLD_CLASSIFICATIONS = (
    "classification IN ('invoice','packing_list','draft_bl','other')"
)


def upgrade() -> None:
    op.alter_column(
        "intake_cases",
        "state",
        type_=sa.String(length=32),
        existing_type=sa.String(length=24),
    )
    op.alter_column(
        "activity_events",
        "before_state",
        type_=sa.String(length=32),
        existing_type=sa.String(length=24),
    )
    op.alter_column(
        "activity_events",
        "after_state",
        type_=sa.String(length=32),
        existing_type=sa.String(length=24),
    )
    op.drop_constraint(op.f("ck_intake_cases_state"), "intake_cases", type_="check")
    op.create_check_constraint(op.f("ck_intake_cases_state"), "intake_cases", NEW_CASE_STATES)

    op.drop_constraint(op.f("ck_documents_classification"), "documents", type_="check")
    op.create_check_constraint(
        op.f("ck_documents_classification"), "documents", NEW_CLASSIFICATIONS
    )

    op.add_column(
        "documents",
        sa.Column("version_number", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column("review_snapshots", sa.Column("version_diff", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("review_snapshots", "version_diff")
    op.drop_column("documents", "version_number")

    op.drop_constraint(op.f("ck_documents_classification"), "documents", type_="check")
    op.create_check_constraint(
        op.f("ck_documents_classification"), "documents", OLD_CLASSIFICATIONS
    )

    op.drop_constraint(op.f("ck_intake_cases_state"), "intake_cases", type_="check")
    op.create_check_constraint(op.f("ck_intake_cases_state"), "intake_cases", OLD_CASE_STATES)
    op.alter_column(
        "activity_events",
        "after_state",
        type_=sa.String(length=24),
        existing_type=sa.String(length=32),
    )
    op.alter_column(
        "activity_events",
        "before_state",
        type_=sa.String(length=24),
        existing_type=sa.String(length=32),
    )
    op.alter_column(
        "intake_cases",
        "state",
        type_=sa.String(length=24),
        existing_type=sa.String(length=32),
    )
