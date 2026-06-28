"""ensure_generated_in_source_type_check

Revision ID: 00d6ef3cdec8
Revises: 20260521a001
Create Date: 2026-06-01 14:54:48.238893

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '00d6ef3cdec8'
down_revision: Union[str, None] = '20260521a001'
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
