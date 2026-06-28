"""Task 3.3/T3 (domain CHAT) — CRUD session KHÔNG tự commit nữa.

Gỡ commit ở create_session/delete_session/update_session (route non-streaming →
boundary get_db commit). GIỮ commit ở stream_answer/stream_agent (commit-before
background title task — đọc ở session riêng) và agent save_document_tool (side-effect
bền mid-stream) — đó là boundary cố ý, không thuộc test này.
"""
import uuid

import pytest

from src.core.config import get_settings
from src.models.chat import ChatSession
from src.services.chat_service import ChatService

pytestmark = pytest.mark.asyncio


def _svc(db_session) -> ChatService:
    return ChatService(db_session, get_settings())


def _spy_commit(db_session, calls: list):
    orig = db_session.commit

    async def spy():
        calls.append(1)
        return await orig()

    db_session.commit = spy
    return orig


async def test_create_session_does_not_commit(db_session, test_user):
    calls: list = []
    _spy_commit(db_session, calls)
    svc = _svc(db_session)
    session = await svc.create_session(test_user.id, title="hello")
    assert calls == []
    assert await db_session.get(ChatSession, session.id) is not None


async def test_update_session_does_not_commit(db_session, test_user):
    svc = _svc(db_session)
    session = await svc.create_session(test_user.id, title="t")
    calls: list = []
    _spy_commit(db_session, calls)
    updated = await svc.update_session(session.id, test_user.id, "renamed")
    assert calls == []
    assert updated.title == "renamed"


async def test_delete_session_does_not_commit(db_session, test_user):
    svc = _svc(db_session)
    session = await svc.create_session(test_user.id, title="t")
    calls: list = []
    _spy_commit(db_session, calls)
    await svc.delete_session(session.id, test_user.id)
    assert calls == []


async def test_rollback_undoes_uncommitted_session(db_session, test_user):
    svc = _svc(db_session)
    session = await svc.create_session(test_user.id, title="rollback")
    sid = session.id
    await db_session.rollback()
    assert await db_session.get(ChatSession, sid) is None
