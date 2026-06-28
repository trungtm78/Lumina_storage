"""create review_reviewjob table

Revision ID: 20260424a001
Revises: 20260421a001
Create Date: 2026-04-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260424a001"
down_revision: Union[str, None] = "20260421a001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "review_reviewjob",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users_user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents_document.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "compare_document_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("documents_document.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("document_name", sa.String(512), nullable=False),
        sa.Column("review_type", sa.String(32), nullable=False),
        sa.Column("compare_mode", sa.String(16), nullable=True),
        sa.Column("risk_score", sa.Integer, nullable=False, server_default="0"),
        sa.Column("report", postgresql.JSONB, nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "idx_reviewjob_user_created",
        "review_reviewjob",
        ["user_id", "created_at"],
    )
    op.create_index(
        "idx_reviewjob_user_deleted",
        "review_reviewjob",
        ["user_id", "deleted_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_reviewjob_user_deleted", table_name="review_reviewjob")
    op.drop_index("idx_reviewjob_user_created", table_name="review_reviewjob")
    op.drop_table("review_reviewjob")
