"""add status column to review_reviewjob

Revision ID: 20260602a001
Revises: 20260521a001
Create Date: 2026-06-02
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260602a001"
down_revision: Union[str, None] = "00d6ef3cdec8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "review_reviewjob",
        sa.Column(
            "status",
            sa.String(16),
            nullable=False,
            server_default="reviewing",
        ),
    )
    # Backfill: existing rows are all completed reviews
    op.execute("UPDATE review_reviewjob SET status = 'completed' WHERE deleted_at IS NULL")


def downgrade() -> None:
    op.drop_column("review_reviewjob", "status")
