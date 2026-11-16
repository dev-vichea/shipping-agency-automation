"""Add workspace-scoped watched folders and source receipt lookup.

Revision ID: 0009
Revises: 0008
"""

import sqlalchemy as sa

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "folder_sources",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("company_id", sa.Uuid(), sa.ForeignKey("companies.id"), nullable=False),
        sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("key_hash", sa.String(64), nullable=False),
        sa.Column("last_contact_at", sa.DateTime(timezone=True)),
        sa.Column("last_checked_at", sa.DateTime(timezone=True)),
        sa.Column("last_received_at", sa.DateTime(timezone=True)),
        sa.Column("check_status", sa.String(32)),
    )
    op.create_index("ix_folder_sources_workspace_id", "folder_sources", ["workspace_id"])
    op.create_index(
        "ix_incoming_messages_workspace_channel_thread",
        "incoming_messages",
        ["workspace_id", "channel", "thread_id"],
    )


def downgrade():
    op.drop_index("ix_incoming_messages_workspace_channel_thread", table_name="incoming_messages")
    op.drop_table("folder_sources")
