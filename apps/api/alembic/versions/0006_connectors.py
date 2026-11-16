"""Store workspace connector settings and outbound delivery receipts.

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "gmail_connections",
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id"), primary_key=True),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("mailbox", sa.String(254), nullable=False),
        sa.Column("credential", sa.LargeBinary(), nullable=False),
        sa.Column("history_id", sa.String(32), nullable=False),
        sa.Column("senders", JSONB(), server_default="[]", nullable=False),
        sa.Column("company_id", sa.Uuid(), sa.ForeignKey("companies.id")),
        sa.Column("enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column("error_code", sa.String(64)),
    )
    op.create_table(
        "telegram_recipients",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("chat_id", sa.String(24), nullable=False),
        sa.Column("display_name", sa.String(254), nullable=False),
        sa.UniqueConstraint("workspace_id", "chat_id", name="uq_telegram_workspace_chat"),
    )
    op.create_index("ix_telegram_recipients_workspace_id", "telegram_recipients", ["workspace_id"])
    op.create_table(
        "telegram_deliveries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("case_id", sa.Uuid(), sa.ForeignKey("intake_cases.id"), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("chat_id", sa.String(24), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("provider_message_id", sa.String(24)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "case_id", "chat_id", "revision", "payload_hash", name="uq_telegram_delivery"
        ),
    )


def downgrade():
    raise RuntimeError("Downgrading would discard connector credentials and delivery history.")
