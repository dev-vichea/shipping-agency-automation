"""Record scoped internal CDC reservations from approved import reviews.

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "cdc_reservations",
        sa.Column("import_id", sa.Uuid(), sa.ForeignKey("import_records.id"), primary_key=True),
        sa.Column("master_id", sa.Uuid(), sa.ForeignKey("cdc_master_versions.id"), nullable=False),
        sa.Column("master_row", sa.Integer(), primary_key=True),
        sa.Column("approval_id", sa.Uuid(), sa.ForeignKey("approvals.id"), nullable=False),
        sa.Column("quantity", sa.Numeric(20, 6), nullable=False),
        sa.Column("amount", sa.Numeric(20, 6), nullable=False),
        sa.CheckConstraint(
            "quantity > 0 AND amount >= 0", name=op.f("ck_cdc_reservations_positive")
        ),
    )
    op.create_index(
        "ix_cdc_reservations_master_id", "cdc_reservations", ["master_id", "master_row"]
    )


def downgrade():
    raise RuntimeError("Downgrading would discard active internal CDC reservations.")
