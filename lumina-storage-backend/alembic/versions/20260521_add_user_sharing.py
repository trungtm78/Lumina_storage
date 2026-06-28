"""add user-level sharing to document permissions

Revision ID: 20260521a001
Revises: 20260507a001
Create Date: 2026-05-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = "20260521a001"
down_revision: Union[str, None] = "20260507a001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add user_id column (nullable)
    op.add_column(
        "documents_documentpermission",
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users_user.id", ondelete="CASCADE"), nullable=True),
    )

    # Make group_id nullable (drop NOT NULL constraint)
    op.alter_column("documents_documentpermission", "group_id", nullable=True)

    # Drop old UniqueConstraints (they don't handle NULLs correctly for our use case)
    op.drop_constraint("uq_docperm_doc_group", "documents_documentpermission", type_="unique")
    op.drop_constraint("uq_docperm_folder_group", "documents_documentpermission", type_="unique")

    # Add partial unique indexes for each combination
    op.create_index(
        "uq_docperm_doc_group",
        "documents_documentpermission",
        ["document_id", "group_id"],
        unique=True,
        postgresql_where=sa.text("document_id IS NOT NULL AND group_id IS NOT NULL"),
    )
    op.create_index(
        "uq_docperm_doc_user",
        "documents_documentpermission",
        ["document_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("document_id IS NOT NULL AND user_id IS NOT NULL"),
    )
    op.create_index(
        "uq_docperm_folder_group",
        "documents_documentpermission",
        ["folder_id", "group_id"],
        unique=True,
        postgresql_where=sa.text("folder_id IS NOT NULL AND group_id IS NOT NULL"),
    )
    op.create_index(
        "uq_docperm_folder_user",
        "documents_documentpermission",
        ["folder_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("folder_id IS NOT NULL AND user_id IS NOT NULL"),
    )

    # Add index on user_id for lookups
    op.create_index("idx_docperm_user", "documents_documentpermission", ["user_id"])

    # Add XOR check: exactly one of group_id / user_id must be set
    op.create_check_constraint(
        "chk_docperm_grantee",
        "documents_documentpermission",
        "(group_id IS NOT NULL AND user_id IS NULL) OR (group_id IS NULL AND user_id IS NOT NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("chk_docperm_grantee", "documents_documentpermission", type_="check")
    op.drop_index("idx_docperm_user", table_name="documents_documentpermission")
    op.drop_index("uq_docperm_folder_user", table_name="documents_documentpermission")
    op.drop_index("uq_docperm_doc_user", table_name="documents_documentpermission")
    op.drop_index("uq_docperm_folder_group", table_name="documents_documentpermission")
    op.drop_index("uq_docperm_doc_group", table_name="documents_documentpermission")

    op.create_unique_constraint("uq_docperm_folder_group", "documents_documentpermission", ["folder_id", "group_id"])
    op.create_unique_constraint("uq_docperm_doc_group", "documents_documentpermission", ["document_id", "group_id"])

    op.alter_column("documents_documentpermission", "group_id", nullable=False)
    op.drop_column("documents_documentpermission", "user_id")
