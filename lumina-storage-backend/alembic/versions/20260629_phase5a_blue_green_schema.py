"""Phase 5a blue/green schema: active_ingest_version + chunk ingest_version/search_vector

Thêm nền tảng blue/green re-ingest + FTS chunk-level (A1):
- documents_document.active_ingest_version (TEXT) — con trỏ version đang phục vụ.
- documents_documentchunk.ingest_version (TEXT) — version mỗi chunk.
- documents_documentchunk.search_vector (TSVECTOR) + GIN index — FTS chunk-level.
- UniqueConstraint (document_id, chunk_index) → (document_id, chunk_index, ingest_version)
  cho 2 version coexist trong cửa sổ swap.

BACKFILL (no-regression): chunk cũ ingest_version='legacy' + search_vector từ content;
document có chunk → active_ingest_version='legacy' (để reads lọc theo active vẫn thấy
chunk cũ: 'legacy'=='legacy'; nếu để NULL thì NULL==NULL = false → mất search).
Idempotent: chỉ backfill WHERE ingest_version IS NULL.

Revision ID: 20260629a001
Revises: 20260628a002
Create Date: 2026-06-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import TSVECTOR

revision: str = "20260629a001"
down_revision: Union[str, None] = "20260628a002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")

    # 1) Cột mới. ingest_version NOT NULL + server_default 'legacy' (codex P2): existing rows
    # tự lấp 'legacy', tránh NULL bypass unique + reads NULL==NULL miss. Còn lại nullable.
    op.add_column("documents_document", sa.Column("active_ingest_version", sa.Text(), nullable=True))
    op.add_column(
        "documents_documentchunk",
        sa.Column("ingest_version", sa.Text(), nullable=False, server_default="legacy"),
    )
    op.add_column("documents_documentchunk", sa.Column("search_vector", TSVECTOR(), nullable=True))

    # 2) Backfill no-regression: FTS chunk-level từ content (ingest_version đã = 'legacy' qua default).
    op.execute(
        """
        UPDATE documents_documentchunk
        SET search_vector = to_tsvector('simple', unaccent(content))
        WHERE search_vector IS NULL
        """
    )
    # Document có chunk → active = 'legacy' (reads lọc active vẫn thấy chunk cũ).
    op.execute(
        """
        UPDATE documents_document d
        SET active_ingest_version = 'legacy'
        WHERE d.active_ingest_version IS NULL
          AND EXISTS (SELECT 1 FROM documents_documentchunk c WHERE c.document_id = d.id)
        """
    )

    # 3) Đổi unique constraint cho blue/green coexist.
    op.drop_constraint("uq_documentchunk_doc_index", "documents_documentchunk", type_="unique")
    op.create_unique_constraint(
        "uq_documentchunk_doc_index_version",
        "documents_documentchunk",
        ["document_id", "chunk_index", "ingest_version"],
    )

    # 4) GIN index FTS chunk-level.
    op.create_index(
        "idx_documentchunk_fts",
        "documents_documentchunk",
        ["search_vector"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    # Rollback vận hành ƯU TIÊN tắt feature-flag (Settings.extraction_blue_green=False),
    # KHÔNG drop cột (tránh mất active_ingest_version). Downgrade này best-effort: giả định
    # KHÔNG còn blue/green duplicate (doc, index) đang tồn tại; nếu có, recreate constraint cũ
    # sẽ lỗi → dọn duplicate trước hoặc giữ schema mới.
    op.drop_index("idx_documentchunk_fts", table_name="documents_documentchunk")
    op.drop_constraint("uq_documentchunk_doc_index_version", "documents_documentchunk", type_="unique")
    op.create_unique_constraint(
        "uq_documentchunk_doc_index",
        "documents_documentchunk",
        ["document_id", "chunk_index"],
    )
    op.drop_column("documents_documentchunk", "search_vector")
    op.drop_column("documents_documentchunk", "ingest_version")
    op.drop_column("documents_document", "active_ingest_version")
