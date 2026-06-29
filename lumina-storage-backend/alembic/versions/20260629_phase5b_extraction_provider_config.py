"""Phase 5b: ExtractionProviderConfig table (pluggable extraction provider gateway)

Bảng cấu hình provider trích xuất (admin chọn qua UI). api_key = Text (EncryptedString ở
tầng ORM, lưu 'enc:...'); options/applies_to JSONB; routing priority + một default toàn cục
(partial unique trên is_default where TRUE).

Revision ID: 20260629b001
Revises: 20260629a001
Create Date: 2026-06-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "20260629b001"
down_revision: Union[str, None] = "20260629a001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "extraction_extractionproviderconfig",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("provider", sa.String(50), nullable=False),
        sa.Column("api_key", sa.Text(), nullable=True),       # EncryptedString (ORM) → 'enc:...'
        sa.Column("base_url", sa.String(512), nullable=True),
        sa.Column("options", JSONB(), nullable=True),
        sa.Column("applies_to", JSONB(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index(
        "idx_extractionprovider_active",
        "extraction_extractionproviderconfig",
        ["is_active", "priority"],
    )
    op.create_index(
        "uq_extractionprovider_one_default",
        "extraction_extractionproviderconfig",
        ["is_default"],
        unique=True,
        postgresql_where=sa.text("is_default = TRUE"),
    )


def downgrade() -> None:
    op.drop_index("uq_extractionprovider_one_default", table_name="extraction_extractionproviderconfig")
    op.drop_index("idx_extractionprovider_active", table_name="extraction_extractionproviderconfig")
    op.drop_table("extraction_extractionproviderconfig")
