"""Store verified English company aliases and advisory translations.

Revision ID: 0010
Revises: 0009
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("companies", sa.Column("verified_english_name", sa.String(254)))
    op.add_column("review_snapshots", sa.Column("translations", JSONB))


def downgrade():
    op.drop_column("review_snapshots", "translations")
    op.drop_column("companies", "verified_english_name")
