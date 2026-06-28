"""add pdf_document_id to review_reviewjob

Revision ID: 20260610a001
Revises: 232231c83817
Create Date: 2026-06-10
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "20260610a001"
down_revision: Union[str, None] = "232231c83817"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "review_reviewjob",
        sa.Column(
            "pdf_document_id",
            UUID(as_uuid=True),
            sa.ForeignKey("documents_document.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("review_reviewjob", "pdf_document_id")
