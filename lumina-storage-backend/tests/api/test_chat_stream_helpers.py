"""P8 W2.3 — decompose stream_agent: helper _save_user_message (lưu user message, flush, no commit).

Trích bước lưu user-message khỏi method stream_agent (262 dòng) thành helper testable. Bất biến:
chỉ flush (commit ở boundary get_db / COMMIT CỐ Ý 553 trong stream_agent), trả ChatMessage.
"""
import pytest

from src.core.config import get_settings
from src.models.chat import ChatMessage, ChatSession
from src.services.chat_service import ChatService

pytestmark = pytest.mark.asyncio


async def test_save_user_message_persists_no_commit(db_session, test_user):
    s = ChatSession(user_id=test_user.id, title="t")
    db_session.add(s)
    await db_session.flush()

    calls: list = []
    orig = db_session.commit

    async def spy():
        calls.append(1)
        return await orig()

    db_session.commit = spy

    svc = ChatService(db=db_session, settings=get_settings())
    msg = await svc._save_user_message(s.id, "xin chào", None)

    assert isinstance(msg, ChatMessage)
    assert msg.content == "xin chào"
    assert msg.role == "user"
    assert calls == []  # helper chỉ flush, KHÔNG commit (boundary get_db)


async def test_save_user_message_with_attachments(db_session, test_user):
    s = ChatSession(user_id=test_user.id, title="t")
    db_session.add(s)
    await db_session.flush()

    svc = ChatService(db=db_session, settings=get_settings())
    # document_ids=None → attachments None (không query Document)
    msg = await svc._save_user_message(s.id, "hỏi", None)
    assert msg.attachments is None
