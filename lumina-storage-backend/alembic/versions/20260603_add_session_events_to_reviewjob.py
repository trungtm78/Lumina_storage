"""add session_events column to review_reviewjob

Revision ID: 20260603b001
Revises: 20260603a001
Create Date: 2026-06-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260603b001"
down_revision: Union[str, None] = "20260603a001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "review_reviewjob",
        sa.Column(
            "session_events",
            JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("review_reviewjob", "session_events")
