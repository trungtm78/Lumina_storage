"""Phase 5a Task 5 — golden recall: pipeline retrieval trả ĐÚNG chunk liên quan top-rank.

Deterministic (FTS thật trên Postgres test, vector mock []): query keyword → chunk khớp đứng
đầu (recall@1). Bổ trợ cho test_retrieval_hybrid (filter) + test_ingest_blue_green (ingest).
"""
import uuid

import pytest
from sqlalchemy import text as sa_text

from src.models.document import Document, DocumentChunk
from src.models.storage import StorageConfig
from src.services.retrieval_service import RetrievalService

pytestmark = pytest.mark.asyncio


class _FakeEmbed:
    async def embed_query(self, q):
        return [0.1, 0.2, 0.3, 0.4]


class _NoVector:
    async def search(self, query_vector, top_k, **kw):
        return []  # vector tắt → FTS dẫn dắt ranking (golden keyword recall)


_GOLDEN = [
    ("hợp đồng thuê nhà ở quận 1 thời hạn 2 năm", "thuê nhà"),
    ("báo cáo doanh thu quý 4 tăng trưởng mạnh", "doanh thu quý 4"),
    ("biên bản họp hội đồng quản trị về nhân sự", "hội đồng quản trị"),
]


async def test_golden_recall_at_1(db_session):
    sc = StorageConfig(id=uuid.uuid4(), name="t", backend_type="local", config={}, is_active=True)
    db_session.add(sc)
    await db_session.flush()

    chunk_by_topic = {}
    doc_ids = []
    for content, _ in _GOLDEN:
        doc = Document(
            id=uuid.uuid4(), title="t", file_name="f", original_filename="f", file_path="/f",
            file_size=1, mime_type="text/plain", extension=".txt", checksum="c",
            storage_config_id=sc.id, owner_id=None, active_ingest_version="v1",
        )
        db_session.add(doc)
        await db_session.flush()
        ch = DocumentChunk(id=uuid.uuid4(), document_id=doc.id, chunk_index=0,
                           content=content, ingest_version="v1")
        db_session.add(ch)
        chunk_by_topic[content] = ch.id
        doc_ids.append(doc.id)
    await db_session.flush()
    await db_session.execute(sa_text(
        "UPDATE documents_documentchunk SET search_vector = to_tsvector('simple', unaccent(content)) "
        "WHERE ingest_version = 'v1'"
    ))

    svc = RetrievalService(db_session, _NoVector(), _FakeEmbed())
    hits = 0
    for content, query in _GOLDEN:
        results = await svc.hybrid_search(query, top_k=3, document_ids=doc_ids)
        if results and results[0].chunk_id == chunk_by_topic[content]:
            hits += 1
    # recall@1 == 100% trên golden (mỗi query khớp đúng chunk chủ đề top-rank).
    assert hits == len(_GOLDEN)
