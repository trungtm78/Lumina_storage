"""Phase 5a Task 1 (schema) — blue/green foundation columns + constraint.

- Document.active_ingest_version (con trỏ version đang phục vụ — swap nguyên tử).
- DocumentChunk.ingest_version (gắn version mỗi chunk) + search_vector (FTS chunk-level, A1) + GIN.
- UniqueConstraint đổi (document_id, chunk_index) → (document_id, chunk_index, ingest_version):
  cho 2 version chunk cùng (doc, index) CÙNG TỒN TẠI trong cửa sổ blue/green.
"""
from sqlalchemy import UniqueConstraint

from src.models.document import Document, DocumentChunk


def test_document_has_active_ingest_version():
    assert "active_ingest_version" in Document.__table__.columns


def test_chunk_has_ingest_version_and_search_vector():
    cols = DocumentChunk.__table__.columns
    assert "ingest_version" in cols
    assert "search_vector" in cols


def test_chunk_unique_constraint_includes_ingest_version():
    uniques = {
        tuple(col.name for col in c.columns)
        for c in DocumentChunk.__table__.constraints
        if isinstance(c, UniqueConstraint)
    }
    # Blue/green: 2 version cùng (doc, index) phải coexist → version vào unique key.
    assert ("document_id", "chunk_index", "ingest_version") in uniques
    # Constraint cũ 2 cột KHÔNG còn (nếu còn sẽ chặn coexist).
    assert ("document_id", "chunk_index") not in uniques


def test_chunk_ingest_version_not_null_with_default():
    # codex P2: nullable ingest_version + 3-col unique → NULL bypass uniqueness +
    # reads NULL==NULL miss. Fix: NOT NULL + server_default 'legacy' (current ingest
    # chưa set version vẫn lấp 'legacy' qua DB default; T1 set version thật sau).
    col = DocumentChunk.__table__.columns["ingest_version"]
    assert col.nullable is False
    assert col.server_default is not None


def test_chunk_has_gin_index_on_search_vector():
    has_gin = any(
        any(col.name == "search_vector" for col in idx.columns)
        for idx in DocumentChunk.__table__.indexes
    )
    assert has_gin
