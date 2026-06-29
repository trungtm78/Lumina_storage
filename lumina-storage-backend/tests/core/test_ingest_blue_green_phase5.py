"""Phase 5a Task 2e — e2e ingest_document_task blue/green state-machine (R1/R3/R8).

State-machine (flag extraction_blue_green=True): KHÔNG xóa cũ trước → upsert V_new (payload
ingest_version=V_new) + INSERT chunk version V_new + token_count → set active=V_new → COMMIT
(swap) → SAU commit delete_stale Qdrant + DELETE chunk version cũ. Crash/empty → giữ bản cũ.

Mock heavy deps (storage/extraction/embedding/vector/vlm-config); DB thật qua test_engine.
"""
import uuid

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.models.core import AIModelConfig
from src.models.document import Document, DocumentChunk, DocumentContent
from src.models.processing import BackgroundTask
from src.models.storage import StorageConfig
from src.services.text_extraction_service import PageResult

pytestmark = pytest.mark.asyncio


class _FakeBackend:
    async def read(self, path):
        return b"unused"


class _FakeEmbed:
    @classmethod
    async def from_db_default(cls, db):
        return cls()

    async def embed_texts(self, texts):
        return [[0.1, 0.2, 0.3, 0.4] for _ in texts]


class _FakeVector:
    upserts: list = []
    stale: list = []
    deleted: list = []

    def __init__(self, settings):
        pass

    async def upsert_chunks(self, points):
        _FakeVector.upserts.extend(points)

    async def delete_stale_versions(self, document_id, keep_version):
        _FakeVector.stale.append((str(document_id), keep_version))

    async def delete_by_document(self, document_id):
        _FakeVector.deleted.append(str(document_id))


class _FakeExtractor:
    # Phase 5b: đóng vai LocalHybridProvider (cùng interface extract) — seam ingest giờ qua provider.
    name = "local_hybrid"

    def __init__(self, **kwargs):
        pass

    async def extract(self, file_bytes, mime_type, extension):
        return [PageResult(page_number=1, text="Một câu nội dung test.", confidence=1.0)]


class _Cfg:
    model = "gpt-4o"

    def to_kwargs(self, **o):
        return {"model": "gpt-4o"}


async def _fake_get_default(db, purpose):
    return _Cfg()


def _patch_all(monkeypatch, extractor=_FakeExtractor):
    _FakeVector.upserts = []
    _FakeVector.stale = []
    _FakeVector.deleted = []
    import src.worker.tasks.document as d

    monkeypatch.setattr(d, "EmbeddingService", _FakeEmbed)
    monkeypatch.setattr(d, "VectorService", _FakeVector)
    monkeypatch.setattr(d, "LocalHybridProvider", extractor)  # seam Phase 5b: provider
    monkeypatch.setattr(d, "get_storage_backend", lambda cfg: _FakeBackend())
    monkeypatch.setattr(
        "src.services.ai_model_config_service.get_default_litellm_config", _fake_get_default
    )


async def _seed_document(sf) -> uuid.UUID:
    async with sf() as s:
        sc = StorageConfig(id=uuid.uuid4(), name="t", backend_type="local", config={}, is_active=True)
        s.add(sc)
        await s.flush()
        doc = Document(
            id=uuid.uuid4(), title="t", file_name="f.txt", original_filename="f.txt",
            file_path="/x/f.txt", file_size=10, mime_type="text/plain", extension=".txt",
            checksum="c", storage_config_id=sc.id, owner_id=None,
        )
        s.add(doc)
        await s.commit()
        return doc.id


async def _cleanup(sf, doc_id):
    async with sf() as s:
        await s.execute(delete(DocumentChunk).where(DocumentChunk.document_id == doc_id))
        await s.execute(delete(DocumentContent).where(DocumentContent.document_id == doc_id))
        d = await s.get(Document, doc_id)
        if d:
            sc_id = d.storage_config_id
            await s.delete(d)
            await s.flush()
            sc = await s.get(StorageConfig, sc_id)
            if sc:
                await s.delete(sc)
        await s.commit()


async def test_blue_green_state_machine_swaps_and_cleans(test_engine, monkeypatch):
    sf = async_sessionmaker(test_engine, expire_on_commit=False)
    _patch_all(monkeypatch)
    doc_id = await _seed_document(sf)

    # Seed chunk version cũ + active cũ (mô phỏng lần ingest trước) — phải bị swap/cleanup.
    async with sf() as s:
        s.add(DocumentChunk(
            id=uuid.uuid4(), document_id=doc_id, chunk_index=0, content="cũ",
            ingest_version="old-v",
        ))
        d = await s.get(Document, doc_id)
        d.active_ingest_version = "old-v"
        await s.commit()

    from src.worker.tasks.document import ingest_document_task
    await ingest_document_task({"session_factory": sf}, uuid.uuid4(), doc_id)

    async with sf() as s:
        d = await s.get(Document, doc_id)
        chunks = (await s.execute(
            select(DocumentChunk).where(DocumentChunk.document_id == doc_id)
        )).scalars().all()

    # 1) Chunk mới có version = uuid (KHÔNG phải 'old-v'/'legacy'); cleanup đã xóa chunk cũ.
    assert chunks, "phải có chunk mới"
    new_versions = {c.ingest_version for c in chunks}
    assert new_versions == {d.active_ingest_version}  # tất cả chunk = active version
    v_new = d.active_ingest_version
    assert v_new not in ("old-v", "legacy") and len(v_new) >= 16  # uuid
    # 2) token_count điền.
    assert all(c.token_count and c.token_count > 0 for c in chunks)
    # 3) upsert payload có ingest_version=V_new; delete_stale gọi với keep=V_new.
    assert _FakeVector.upserts and all(p.payload["ingest_version"] == v_new for p in _FakeVector.upserts)
    assert (str(doc_id), v_new) in _FakeVector.stale
    # 4) blue/green KHÔNG delete_by_document upfront.
    assert str(doc_id) not in _FakeVector.deleted

    await _cleanup(sf, doc_id)


async def test_empty_extract_keeps_old_and_fails(test_engine, monkeypatch):
    class _EmptyExtractor(_FakeExtractor):
        async def extract(self, file_bytes, mime_type, extension):
            return []

    sf = async_sessionmaker(test_engine, expire_on_commit=False)
    _patch_all(monkeypatch, extractor=_EmptyExtractor)
    doc_id = await _seed_document(sf)

    # Bản tốt cũ: chunk + active.
    async with sf() as s:
        s.add(DocumentChunk(
            id=uuid.uuid4(), document_id=doc_id, chunk_index=0, content="bản tốt cũ",
            ingest_version="good-v",
        ))
        d = await s.get(Document, doc_id)
        d.active_ingest_version = "good-v"
        d.page_count = 3
        await s.commit()

    async with sf() as s:
        bg = BackgroundTask(task_name="ingest", status="running")
        s.add(bg)
        await s.commit()
        tid = bg.id

    from src.worker.tasks.document import ingest_document_task
    await ingest_document_task({"session_factory": sf}, tid, doc_id)

    async with sf() as s:
        d = await s.get(Document, doc_id)
        chunks = (await s.execute(
            select(DocumentChunk).where(DocumentChunk.document_id == doc_id)
        )).scalars().all()
        bg2 = await s.get(BackgroundTask, tid)

    # R3: extract rỗng → status failure; bản tốt cũ GIỮ NGUYÊN (active + chunk + page_count).
    assert bg2.status == "failure"
    assert d.active_ingest_version == "good-v"
    assert [c.content for c in chunks] == ["bản tốt cũ"]
    assert d.page_count == 3

    async with sf() as s:
        await s.execute(delete(BackgroundTask).where(BackgroundTask.id == tid))
        await s.commit()
    await _cleanup(sf, doc_id)
