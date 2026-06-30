"""Test delete_session KHÔNG poison transaction khi 1 doc delete lỗi DB (review ARCH-P2).

Bug: loop xóa doc bọc `except Exception: pass`. Nếu db.delete raise lỗi DB THẬT (integrity/
driver) → asyncpg poison session, exc bị nuốt, `flush()` cuối raise "transaction is aborted"
→ delete_session VỠ + xóa session không nhất quán (session lẽ ra đã xóa nhưng rollback mất).

Fix: savepoint per-doc (begin_nested) → lỗi 1 doc rollback chỉ savepoint đó, session (đã xóa
TRƯỚC loop) vẫn bền; doc khác vẫn xử lý; flush cuối thành công.
"""
import uuid

import pytest
from sqlalchemy import func, select, text

from src.core.config import get_settings
from src.models.chat import ChatMessage, ChatSession
from src.models.document import Document
from src.services.chat_service import ChatService

pytestmark = pytest.mark.asyncio


async def _make_doc(db, owner_id, storage_config_id):
    doc = Document(
        id=uuid.uuid4(),
        title="d.docx",
        file_name=f"{uuid.uuid4()}.docx",
        original_filename="d.docx",
        file_path="/tmp/lumina-test/d.docx",
        file_size=1,
        mime_type="application/octet-stream",
        extension="docx",
        checksum="x",
        folder_id=None,
        storage_config_id=storage_config_id,
        owner_id=owner_id,
        source_type="skill_temp",
    )
    db.add(doc)
    await db.flush()
    return doc


async def test_delete_session_survives_poisoned_doc_delete(
    db_session, test_user, default_storage_config, monkeypatch
):
    svc = ChatService(db=db_session, settings=get_settings())
    session = ChatSession(user_id=test_user.id)
    db_session.add(session)
    await db_session.flush()
    doc = await _make_doc(db_session, test_user.id, default_storage_config.id)
    msg = ChatMessage(
        session_id=session.id,
        role="assistant",
        content="x",
        skill_result={"rendered_document_id": str(doc.id)},
    )
    db_session.add(msg)
    await db_session.flush()
    sid = session.id

    # Ép doc delete gây lỗi DB THẬT → poison transaction NẾU không có savepoint cô lập.
    async def poison_delete(obj):
        await db_session.execute(text("SELECT 1/0"))

    monkeypatch.setattr(db_session, "delete", poison_delete)

    # KHÔNG được raise (best-effort doc cleanup, không làm vỡ xóa session).
    await svc.delete_session(sid, test_user.id)
    monkeypatch.undo()

    # Session PHẢI đã bị xóa (nhất quán), bất kể doc delete lỗi.
    db_session.expire_all()
    remaining = await db_session.scalar(
        select(func.count()).select_from(ChatSession).where(ChatSession.id == sid)
    )
    assert remaining == 0
