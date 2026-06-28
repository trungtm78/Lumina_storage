"""Test IDOR chat session: user B không được đọc/sửa/xóa session của user A."""
import pytest

from src.models.chat import ChatSession

pytestmark = pytest.mark.asyncio


async def _make_session(db, user_id):
    s = ChatSession(user_id=user_id)
    db.add(s)
    await db.flush()
    return s


async def test_delete_other_users_session_404(async_client, db_session, superuser, auth_headers):
    s = await _make_session(db_session, superuser.id)  # thuộc superuser
    r = await async_client.delete(f"/api/v1/chat/sessions/{s.id}", headers=auth_headers)  # test_user
    assert r.status_code == 404


async def test_update_other_users_session_404(async_client, db_session, superuser, auth_headers):
    s = await _make_session(db_session, superuser.id)
    r = await async_client.patch(
        f"/api/v1/chat/sessions/{s.id}", json={"title": "hijack"}, headers=auth_headers
    )
    assert r.status_code == 404


async def test_get_messages_other_users_session_404(async_client, db_session, superuser, auth_headers):
    s = await _make_session(db_session, superuser.id)
    r = await async_client.get(f"/api/v1/chat/sessions/{s.id}/messages", headers=auth_headers)
    assert r.status_code == 404


async def test_owner_can_delete_own_session(async_client, db_session, test_user, auth_headers):
    s = await _make_session(db_session, test_user.id)
    r = await async_client.delete(f"/api/v1/chat/sessions/{s.id}", headers=auth_headers)
    assert r.status_code == 204
