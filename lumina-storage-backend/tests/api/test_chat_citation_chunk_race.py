"""Test citation chunk_id race: source trỏ chunk đã bị re-ingest xóa → degrade NULL (ARCH-P2).

Bug: rag_search thu chunk_id active, rồi (sau khi LLM stream xong, vài giây) insert
ChatMessageSource trỏ các chunk_id đó + commit. Nếu blue/green re-ingest CÙNG document commit
swap + cleanup (xóa chunk non-active) GIỮA retrieval và commit → INSERT trỏ chunk đã xóa →
FK violation lúc commit → crash stream sau output dở, mất assistant message.

Fix: validate chunk còn sống NGAY trước insert, degrade chunk_id=NULL nếu mất (FK nullable,
ondelete SET NULL) — thu hẹp cửa sổ race từ cả stream LLM xuống sub-ms.
"""
import uuid

import pytest

from src.core.config import get_settings
from src.models.chat import ChatMessage, ChatMessageSource, ChatSession
from src.models.document import Document
from src.services.chat_service import ChatService
from src.shared.models.document import DocumentChunk

pytestmark = pytest.mark.asyncio


async def _make_doc(db, owner_id, storage_config_id):
    doc = Document(
        id=uuid.uuid4(), title="d.txt", file_name=f"{uuid.uuid4()}.txt",
        original_filename="d.txt", file_path="/tmp/lumina-test/d.txt", file_size=1,
        mime_type="text/plain", extension="txt", checksum="x", folder_id=None,
        storage_config_id=storage_config_id, owner_id=owner_id, source_type="upload",
    )
    db.add(doc)
    await db.flush()
    return doc


async def test_source_referencing_deleted_chunk_degrades_to_null(
    db_session, test_user, default_storage_config
):
    svc = ChatService(db=db_session, settings=get_settings())
    session = ChatSession(user_id=test_user.id)
    db_session.add(session)
    await db_session.flush()
    doc = await _make_doc(db_session, test_user.id, default_storage_config.id)
    chunk = DocumentChunk(document_id=doc.id, chunk_index=0, content="alive")
    db_session.add(chunk)
    await db_session.flush()
    msg = ChatMessage(session_id=session.id, role="assistant", content="x")
    db_session.add(msg)
    await db_session.flush()

    alive = ChatMessageSource(
        message_id=msg.id, document_id=doc.id, chunk_id=chunk.id, citation_index=0
    )
    # chunk_id trỏ chunk KHÔNG tồn tại (mô phỏng re-ingest đã xóa GIỮA retrieval và commit).
    dead = ChatMessageSource(
        message_id=msg.id, document_id=doc.id, chunk_id=uuid.uuid4(), citation_index=1
    )

    await svc._nullify_missing_chunk_ids([alive, dead])

    assert alive.chunk_id == chunk.id  # chunk còn sống → giữ nguyên
    assert dead.chunk_id is None       # chunk đã xóa → degrade NULL

    # PHẢI flush được (không FK-violate) sau khi degrade.
    db_session.add_all([alive, dead])
    await db_session.flush()


async def test_nullify_no_chunk_ids_noop(db_session, test_user):
    """Source không có chunk_id (chunk_id=None) → no-op, không query thừa."""
    svc = ChatService(db=db_session, settings=get_settings())
    src = ChatMessageSource(
        message_id=uuid.uuid4(), document_id=uuid.uuid4(), chunk_id=None, citation_index=0
    )
    await svc._nullify_missing_chunk_ids([src])  # không raise
    assert src.chunk_id is None
