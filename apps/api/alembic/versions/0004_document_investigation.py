"""checkpoint bounded document investigations on existing automation runs

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

TABLE = "automation_runs"
CONSTRAINT = "ck_automation_runs_stage"


def upgrade() -> None:
    op.add_column(TABLE, sa.Column("investigation", postgresql.JSONB()))
    op.drop_constraint(op.f(CONSTRAINT), TABLE, type_="check")
    op.create_check_constraint(
        op.f(CONSTRAINT),
        TABLE,
        "stage IN ('receipt','health_check','analysis','ai','investigation')",
    )


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text("SELECT EXISTS (SELECT 1 FROM automation_runs WHERE stage = 'investigation')")
    ):
        raise RuntimeError("Preserve investigation history before downgrading this database.")
    op.drop_constraint(op.f(CONSTRAINT), TABLE, type_="check")
    op.create_check_constraint(
        op.f(CONSTRAINT), TABLE, "stage IN ('receipt','health_check','analysis','ai')"
    )
    op.drop_column(TABLE, "investigation")
