"""add locale preference to users_user

Revision ID: 20260507a001
Revises: 20260428a002
Create Date: 2026-05-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260507a001"
down_revision: Union[str, None] = "20260428a002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users_user",
        sa.Column(
            "locale",
            sa.String(10),
            nullable=False,
            server_default="vi",
        ),
    )


def downgrade() -> None:
    op.drop_column("users_user", "locale")
