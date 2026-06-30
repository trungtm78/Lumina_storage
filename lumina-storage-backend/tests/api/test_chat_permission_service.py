"""P8 W2.1 — ChatPermissionService.assert_owned: IDOR check (chống lộ session người khác)."""
import uuid

import pytest

from src.core.exceptions import NotFoundError
from src.models.chat import ChatSession
from src.services.chat_permission_service import ChatPermissionService

pytestmark = pytest.mark.asyncio


async def _make_session(db_session, user_id) -> ChatSession:
    s = ChatSession(user_id=user_id, title="t")
    db_session.add(s)
    await db_session.flush()
    return s


async def test_assert_owned_returns_session_for_owner(db_session, test_user):
    s = await _make_session(db_session, test_user.id)
    got = await ChatPermissionService(db_session).assert_owned(s.id, test_user.id)
    assert got.id == s.id


async def test_assert_owned_raises_for_other_user(db_session, test_user):
    s = await _make_session(db_session, test_user.id)
    with pytest.raises(NotFoundError):
        await ChatPermissionService(db_session).assert_owned(s.id, uuid.uuid4())


async def test_assert_owned_raises_for_missing(db_session, test_user):
    with pytest.raises(NotFoundError):
        await ChatPermissionService(db_session).assert_owned(uuid.uuid4(), test_user.id)


async def test_assert_owned_raises_for_soft_deleted(db_session, test_user):
    from datetime import datetime, timezone
    s = await _make_session(db_session, test_user.id)
    s.deleted_at = datetime.now(timezone.utc)
    await db_session.flush()
    with pytest.raises(NotFoundError):
        await ChatPermissionService(db_session).assert_owned(s.id, test_user.id)
