"""Add workspace memberships and company access.

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

DEFAULT = "00000000-0000-4000-8000-000000000001"


def upgrade():
    op.create_table(
        "workspaces",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(254), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.execute(f"INSERT INTO workspaces (id, name) VALUES ('{DEFAULT}', 'Shipping Agency')")
    op.create_table(
        "workspace_members",
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("role", sa.String(16), nullable=False),
        sa.CheckConstraint("role IN ('admin','operator')", name=op.f("ck_workspace_members_role")),
    )
    op.create_index("ix_workspace_members_user_id", "workspace_members", ["user_id"])
    op.execute(f"INSERT INTO workspace_members SELECT '{DEFAULT}', id, 'admin' FROM users")
    for table in (
        "companies",
        "intake_cases",
        "incoming_messages",
        "automation_runs",
        "cdc_master_versions",
    ):
        op.add_column(
            table,
            sa.Column(
                "workspace_id",
                sa.Uuid(),
                sa.ForeignKey("workspaces.id"),
                server_default=DEFAULT,
                nullable=False,
            ),
        )
        if table != "incoming_messages":
            op.create_index(f"ix_{table}_workspace_id", table, ["workspace_id"])
    op.drop_constraint("uq_companies_identity_key", "companies", type_="unique")
    op.create_unique_constraint(
        "uq_company_workspace_identity", "companies", ["workspace_id", "identity_key"]
    )
    op.drop_constraint("uq_message_channel_provider", "incoming_messages", type_="unique")
    op.create_unique_constraint(
        "uq_message_workspace_provider",
        "incoming_messages",
        ["workspace_id", "channel", "provider_message_id"],
    )
    op.drop_constraint("uq_cdc_version", "cdc_master_versions", type_="unique")
    op.create_unique_constraint(
        "uq_cdc_version",
        "cdc_master_versions",
        ["workspace_id", "company_key", "year", "approval_ref", "sha256"],
    )

    op.add_column("companies", sa.Column("aliases", JSONB(), server_default="[]", nullable=False))
    for field, length in (("identifier", 160), ("contact_name", 254), ("contact_email", 254)):
        op.add_column("companies", sa.Column(field, sa.String(length)))
    op.create_table(
        "company_members",
        sa.Column("company_id", sa.Uuid(), sa.ForeignKey("companies.id"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), primary_key=True),
    )
    op.create_index("ix_company_members_user_id", "company_members", ["user_id"])
    for table in ("intake_cases", "cdc_master_versions"):
        op.add_column(table, sa.Column("company_id", sa.Uuid(), sa.ForeignKey("companies.id")))
        op.create_index(f"ix_{table}_company_id", table, ["company_id"])
    op.execute(
        "UPDATE intake_cases c SET company_id = r.company_id FROM import_records r WHERE r.intake_case_id = c.id"
    )
    op.execute(
        "UPDATE cdc_master_versions m SET company_id = c.id FROM companies c WHERE lower(m.company) = c.identity_key"
    )


def downgrade():
    raise RuntimeError("Downgrading would discard workspace and company access boundaries.")
