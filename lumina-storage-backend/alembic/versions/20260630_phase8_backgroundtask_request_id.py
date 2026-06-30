"""Phase 8 T3 — BackgroundTask.request_id (correlation-id propagate API→worker).

Revision ID: 20260630a002
Revises: 20260630a001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260630a002"
down_revision: Union[str, None] = "20260630a001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "processing_backgroundtask",
        sa.Column("request_id", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("processing_backgroundtask", "request_id")
