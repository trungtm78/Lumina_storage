"""add processing_status to documents_document

Revision ID: 20260402a001
Revises: None
Create Date: 2026-04-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260402a001"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "documents_document",
        sa.Column("processing_status", sa.String(20), nullable=False, server_default="pending"),
    )
    # Backfill from BackgroundTask: use actual task status
    # Documents whose latest ingest task succeeded → completed
    op.execute("""
        UPDATE documents_document d
        SET processing_status = 'completed'
        WHERE EXISTS (
            SELECT 1 FROM processing_backgroundtask t
            WHERE t.related_id = d.id
              AND t.related_type = 'document'
              AND t.task_name = 'ingest_document'
              AND t.status = 'success'
        )
    """)
    # Documents whose latest ingest task failed → failed
    op.execute("""
        UPDATE documents_document d
        SET processing_status = 'failed'
        WHERE processing_status = 'pending'
          AND EXISTS (
            SELECT 1 FROM processing_backgroundtask t
            WHERE t.related_id = d.id
              AND t.related_type = 'document'
              AND t.task_name = 'ingest_document'
              AND t.status = 'failure'
        )
    """)
    # Documents with page_count set but no task record → also completed
    op.execute(
        "UPDATE documents_document SET processing_status = 'completed' WHERE processing_status = 'pending' AND page_count IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column("documents_document", "processing_status")
