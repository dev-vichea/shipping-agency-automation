"""staff review, scoped approval, and unsubmitted permit drafts

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa

from alembic import op
from shipping_ai.models import Approval, PermitDraft, StaffReview

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

CASE_STATES = (
    "state IN ('queued','needs_review','ready_for_approval','approved','rejected','failed')"
)


def upgrade() -> None:
    op.drop_constraint(op.f("ck_intake_cases_state"), "intake_cases", type_="check")
    op.create_check_constraint(op.f("ck_intake_cases_state"), "intake_cases", CASE_STATES)
    op.drop_constraint(
        op.f("ck_import_records_phase_one_draft_only"), "import_records", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_import_records_state"), "import_records", "state IN ('draft','approved')"
    )
    op.add_column("import_records", sa.Column("approved_at", sa.DateTime(timezone=True)))
    op.create_index("ix_import_records_approved_at", "import_records", ["approved_at"])
    op.create_check_constraint(
        op.f("ck_import_records_approval_time"),
        "import_records",
        "(state = 'approved') = (approved_at IS NOT NULL)",
    )
    for table in (StaffReview.__table__, Approval.__table__, PermitDraft.__table__):
        op.execute(sa.schema.CreateTable(table))
        for index in table.indexes:
            op.execute(sa.schema.CreateIndex(index))


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text("SELECT EXISTS (SELECT 1 FROM staff_reviews UNION ALL SELECT 1 FROM approvals)")
    ):
        raise RuntimeError(
            "Export and preserve Phase 3 review and approval history before downgrade."
        )
    for table in ("permit_drafts", "approvals", "staff_reviews"):
        op.drop_table(table)
    op.drop_constraint(op.f("ck_import_records_approval_time"), "import_records", type_="check")
    op.drop_index("ix_import_records_approved_at", table_name="import_records")
    op.drop_column("import_records", "approved_at")
    op.drop_constraint(op.f("ck_import_records_state"), "import_records", type_="check")
    op.create_check_constraint(
        op.f("ck_import_records_phase_one_draft_only"), "import_records", "state = 'draft'"
    )
    op.execute("UPDATE intake_cases SET state = 'needs_review' WHERE state = 'ready_for_approval'")
    op.drop_constraint(op.f("ck_intake_cases_state"), "intake_cases", type_="check")
    op.create_check_constraint(
        op.f("ck_intake_cases_state"), "intake_cases", "state IN ('queued','needs_review','failed')"
    )
