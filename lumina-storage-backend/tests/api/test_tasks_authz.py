"""Test authz cho /tasks: ping cần auth; get_task chặn IDOR (đọc task người khác)."""
import pytest

from src.models.processing import BackgroundTask

pytestmark = pytest.mark.asyncio


async def _make_task(db, owner_id):
    t = BackgroundTask(task_name="ping", status="success", owner_id=owner_id, result={"x": 1})
    db.add(t)
    await db.flush()
    return t


async def test_ping_requires_auth(async_client):
    r = await async_client.post("/api/v1/tasks/ping")
    assert r.status_code == 401


async def test_get_task_requires_auth(async_client, db_session, test_user):
    t = await _make_task(db_session, test_user.id)
    r = await async_client.get(f"/api/v1/tasks/{t.id}")
    assert r.status_code == 401


async def test_get_task_owner_can_read(async_client, db_session, test_user, auth_headers):
    t = await _make_task(db_session, test_user.id)
    r = await async_client.get(f"/api/v1/tasks/{t.id}", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["id"] == str(t.id)


async def test_get_task_other_user_returns_404(async_client, db_session, superuser, auth_headers):
    # task thuộc superuser; test_user (auth_headers, non-admin) đọc → 404 (không lộ existence)
    t = await _make_task(db_session, superuser.id)
    r = await async_client.get(f"/api/v1/tasks/{t.id}", headers=auth_headers)
    assert r.status_code == 404
