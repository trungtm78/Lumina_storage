"""Phase 5a Task 3 — RetrievalService hybrid + RRF + active-filter (R2) + ACL (R5).

_rrf_fuse (pure) + hybrid_search DB-backed (FTS thật trên Postgres test): chứng minh
- R2: chunk stale (ingest_version != document.active_ingest_version) BỊ LOẠI dù vector trả về.
- ACL: chunk ngoài document_ids KHÔNG lọt qua nhánh FTS.
- RRF fuse vector + FTS theo chunk_id.
"""
import uuid

import pytest
from sqlalchemy import text as sa_text

from src.models.document import Document, DocumentChunk
from src.models.storage import StorageConfig
from src.services.retrieval_service import RetrievalService, _rrf_fuse
from src.services.vector_service import SearchResult

pytestmark = pytest.mark.asyncio


# ── _rrf_fuse (pure) ─────────────────────────────────────────────────────────
async def test_rrf_prefers_items_in_both_lists():
    vec = ["A", "B", "C"]
    fts = ["C", "D", "A"]
    fused = _rrf_fuse([vec, fts])
    assert set(fused[:2]) == {"A", "C"}  # xuất hiện cả 2 list → điểm cao nhất


async def test_rrf_empty():
    assert _rrf_fuse([[], []]) == []


# ── hybrid_search (DB-backed FTS) ─────────────────────────────────────────────
class _FakeEmbed:
    async def embed_query(self, q):
        return [0.1, 0.2, 0.3, 0.4]


class _FakeVector:
    def __init__(self, results):
        self._results = results

    async def search(self, query_vector, top_k, **kw):
        return self._results


async def _seed(db):
    sc = StorageConfig(id=uuid.uuid4(), name="t", backend_type="local", config={}, is_active=True)
    db.add(sc)
    await db.flush()

    def _doc(active):
        d = Document(
            id=uuid.uuid4(), title="t", file_name="f", original_filename="f",
            file_path="/f", file_size=1, mime_type="text/plain", extension=".txt",
            checksum="c", storage_config_id=sc.id, owner_id=None,
            active_ingest_version=active,
        )
        db.add(d)
        return d

    doc_a = _doc("v1")
    doc_c = _doc("v1")  # ngoài document_ids → ACL phải loại
    await db.flush()

    # docA: chunk active (v1) + chunk stale (v0) cùng nội dung khớp query.
    c_active = DocumentChunk(id=uuid.uuid4(), document_id=doc_a.id, chunk_index=0,
                             content="doanh thu quý 1 tăng", ingest_version="v1")
    c_stale = DocumentChunk(id=uuid.uuid4(), document_id=doc_a.id, chunk_index=0,
                            content="doanh thu cũ stale", ingest_version="v0")
    # docC: khớp query nhưng ngoài document_ids.
    c_acl = DocumentChunk(id=uuid.uuid4(), document_id=doc_c.id, chunk_index=0,
                          content="doanh thu công ty khác", ingest_version="v1")
    db.add_all([c_active, c_stale, c_acl])
    await db.flush()
    await db.execute(sa_text(
        "UPDATE documents_documentchunk SET search_vector = to_tsvector('simple', unaccent(content)) "
        "WHERE document_id IN (:a, :c)"
    ), {"a": str(doc_a.id), "c": str(doc_c.id)})
    return doc_a, doc_c, c_active, c_stale, c_acl


async def test_hybrid_filters_stale_and_acl(db_session):
    doc_a, doc_c, c_active, c_stale, c_acl = await _seed(db_session)

    # Vector TRẢ cả chunk stale (mô phỏng Qdrant còn version cũ trong cửa sổ swap).
    fake_vec = _FakeVector([
        SearchResult(chunk_id=c_active.id, document_id=doc_a.id, score=0.9, content="x", page_number=1),
        SearchResult(chunk_id=c_stale.id, document_id=doc_a.id, score=0.8, content="x", page_number=1),
    ])
    svc = RetrievalService(db_session, fake_vec, _FakeEmbed())

    results = await svc.hybrid_search("doanh thu", top_k=10, document_ids=[doc_a.id])
    ids = {r.chunk_id for r in results}

    # R2: chunk stale (v0 != active v1) bị loại dù vector trả về.
    assert c_stale.id not in ids
    # chunk active được giữ.
    assert c_active.id in ids
    # ACL: docC ngoài document_ids → không lọt (cả vector lẫn FTS).
    assert c_acl.id not in ids
    # content lấy từ DB (active).
    active_row = next(r for r in results if r.chunk_id == c_active.id)
    assert "doanh thu quý 1" in active_row.content


async def test_hybrid_excludes_soft_deleted_document(db_session):
    import datetime

    sc = StorageConfig(id=uuid.uuid4(), name="t", backend_type="local", config={}, is_active=True)
    db_session.add(sc)
    await db_session.flush()
    doc = Document(
        id=uuid.uuid4(), title="t", file_name="f", original_filename="f", file_path="/f",
        file_size=1, mime_type="text/plain", extension=".txt", checksum="c",
        storage_config_id=sc.id, owner_id=None, active_ingest_version="v1",
        deleted_at=datetime.datetime(2026, 6, 29, tzinfo=datetime.timezone.utc),  # soft-deleted
    )
    db_session.add(doc)
    await db_session.flush()
    ch = DocumentChunk(id=uuid.uuid4(), document_id=doc.id, chunk_index=0,
                       content="doanh thu bí mật", ingest_version="v1")
    db_session.add(ch)
    await db_session.flush()
    await db_session.execute(sa_text(
        "UPDATE documents_documentchunk SET search_vector = to_tsvector('simple', unaccent(content)) "
        "WHERE id = :id"
    ), {"id": str(ch.id)})

    # Vector vẫn trả chunk (Qdrant không biết soft-delete) → hydrate gate phải loại.
    fake_vec = _FakeVector([
        SearchResult(chunk_id=ch.id, document_id=doc.id, score=0.9, content="x", page_number=1),
    ])
    svc = RetrievalService(db_session, fake_vec, _FakeEmbed())
    results = await svc.hybrid_search("doanh thu", top_k=10, document_ids=[doc.id])
    assert ch.id not in {r.chunk_id for r in results}  # document soft-deleted → không lọt
