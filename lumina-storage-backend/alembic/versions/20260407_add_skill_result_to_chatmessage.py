"""add skill_result JSONB to chat_chatmessage

Revision ID: 20260407a001
Revises: 20260402a001
Create Date: 2026-04-07

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "20260407a001"
down_revision: Union[str, None] = "20260402a001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "chat_chatmessage",
        sa.Column("skill_result", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chat_chatmessage", "skill_result")
