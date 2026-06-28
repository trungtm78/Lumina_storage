"""add template support: expand source_type check + partial index

Revision ID: 20260407a003
Revises: 20260407a002
Create Date: 2026-04-07

"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260407a003"
down_revision: Union[str, None] = "20260407a002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Expand source_type check constraint to include 'template'
    op.execute(
        "ALTER TABLE documents_document DROP CONSTRAINT IF EXISTS documents_document_source_type_check"
    )
    op.create_check_constraint(
        "documents_document_source_type_check",
        "documents_document",
        "source_type IN ('upload', 'sharepoint', 'google_drive', 'skill_temp', 'template')",
    )

    op.create_index(
        "idx_document_source_type_template",
        "documents_document",
        ["source_type"],
        postgresql_where="source_type = 'template'",
    )


def downgrade() -> None:
    op.drop_index("idx_document_source_type_template", table_name="documents_document")

    op.execute(
        "ALTER TABLE documents_document DROP CONSTRAINT IF EXISTS documents_document_source_type_check"
    )
    op.create_check_constraint(
        "documents_document_source_type_check",
        "documents_document",
        "source_type IN ('upload', 'sharepoint', 'google_drive', 'skill_temp')",
    )
