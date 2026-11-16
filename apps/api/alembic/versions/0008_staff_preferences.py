"""Persist workspace inbox and approval notification preferences per staff account.

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column("approval_alerts", sa.Boolean(), server_default=sa.true(), nullable=False),
    )
    op.add_column(
        "users",
        sa.Column("automation_alerts", sa.Boolean(), server_default=sa.true(), nullable=False),
    )


def downgrade():
    op.drop_column("users", "automation_alerts")
    op.drop_column("users", "approval_alerts")
