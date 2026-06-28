"""add generated to source_type check constraint

Revision ID: 20260421a001
Revises: 20260408a001
Create Date: 2026-04-21
"""
from typing import Sequence, Union
from alembic import op

revision: str = "20260421a001"
down_revision: Union[str, None] = "20260408a001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("documents_document_source_type_check", "documents_document", type_="check")
    op.create_check_constraint(
        "documents_document_source_type_check",
        "documents_document",
        "source_type IN ('upload', 'sharepoint', 'google_drive', 'skill_temp', 'template', 'chat_attachment', 'generated')",
    )


def downgrade() -> None:
    op.drop_constraint("documents_document_source_type_check", "documents_document", type_="check")
    op.create_check_constraint(
        "documents_document_source_type_check",
        "documents_document",
        "source_type IN ('upload', 'sharepoint', 'google_drive', 'skill_temp', 'template', 'chat_attachment')",
    )
