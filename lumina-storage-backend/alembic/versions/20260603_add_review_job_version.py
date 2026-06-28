"""add review_reviewjobversion table for version snapshots

Revision ID: 20260603a001
Revises: 20260602a001
Create Date: 2026-06-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "20260603a001"
down_revision: Union[str, None] = "20260602a001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "review_reviewjobversion",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.Column("job_id", UUID(as_uuid=True), sa.ForeignKey("review_reviewjob.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_num", sa.Integer, nullable=False),
        sa.Column("label", sa.String(64), nullable=False),
        sa.Column("version_type", sa.String(32), nullable=False),
        sa.Column("score", sa.Integer, nullable=False, server_default="0"),
        sa.Column("review_type", sa.String(32), nullable=True),
        sa.Column("result", JSONB, nullable=False),
    )
    op.create_index("idx_reviewjobversion_job_num", "review_reviewjobversion", ["job_id", "version_num"])


def downgrade() -> None:
    op.drop_index("idx_reviewjobversion_job_num", table_name="review_reviewjobversion")
    op.drop_table("review_reviewjobversion")
