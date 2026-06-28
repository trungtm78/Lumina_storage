"""Task 3.4 / T3 (domain GENERATOR + TEMPLATE) — CRUD route KHÔNG tự commit nữa.

Gỡ `await db.commit()` ở các route CRUD của generator (create/update/delete
session + create/update/delete version) → commit dồn về boundary `get_db` cuối
request. Pattern y hệt cho draft-to-template / document-to-template / templates
metadata / commit_template (cùng add→flush→refresh→commit→return), nên các route
nhẹ (session/version) làm GATE đại diện RED→GREEN.

GIỮ (COMMIT CỐ Ý — KHÔNG thuộc test này):
- generate_from_session (status-machine: failed-status phải sống qua `raise`).
- templates extract (commit-trước-enqueue: worker phải thấy extraction_status=pending).
- SkillContext.save_* (artifact side-effect bền mid-script, song song agent.py:257).

Spy `db_session.commit`: async_client override get_db = chính db_session nên route
gọi commit là spy bắt được. Boundary get_db trong test KHÔNG commit (chỉ yield) →
happy-path đọc được nhờ flush (giống test Domain 1/2).
"""
import uuid

import pytest

from src.models.generator import GeneratorSession, GeneratorSessionVersion

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/generator"


def _spy_commit(db_session, calls: list):
    orig = db_session.commit

    async def spy():
        calls.append(1)
        return await orig()

    db_session.commit = spy
    return orig


async def _make_session(async_client, auth_headers) -> str:
    resp = await async_client.post(
        f"{BASE}/sessions",
        json={"doc_type": "test", "title": "s"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


async def test_create_session_route_does_not_commit(async_client, db_session, auth_headers):
    calls: list = []
    _spy_commit(db_session, calls)
    resp = await async_client.post(
        f"{BASE}/sessions",
        json={"doc_type": "test", "title": "hello"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert calls == []
    sid = uuid.UUID(resp.json()["id"])
    assert await db_session.get(GeneratorSession, sid) is not None


async def test_update_session_route_does_not_commit(async_client, db_session, auth_headers):
    sid = await _make_session(async_client, auth_headers)
    calls: list = []
    _spy_commit(db_session, calls)
    resp = await async_client.patch(
        f"{BASE}/sessions/{sid}",
        json={"title": "renamed"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert calls == []
    assert resp.json()["title"] == "renamed"


async def test_delete_session_route_does_not_commit(async_client, db_session, auth_headers):
    sid = await _make_session(async_client, auth_headers)
    calls: list = []
    _spy_commit(db_session, calls)
    resp = await async_client.delete(f"{BASE}/sessions/{sid}", headers=auth_headers)
    assert resp.status_code == 204, resp.text
    assert calls == []


async def test_create_version_route_does_not_commit(async_client, db_session, auth_headers):
    sid = await _make_session(async_client, auth_headers)
    calls: list = []
    _spy_commit(db_session, calls)
    resp = await async_client.post(
        f"{BASE}/sessions/{sid}/versions",
        json={"edited_html": "<p>v1</p>"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert calls == []
    vid = uuid.UUID(resp.json()["id"])
    assert await db_session.get(GeneratorSessionVersion, vid) is not None


async def test_update_version_route_does_not_commit(async_client, db_session, auth_headers):
    sid = await _make_session(async_client, auth_headers)
    resp = await async_client.post(
        f"{BASE}/sessions/{sid}/versions",
        json={"edited_html": "<p>v1</p>"},
        headers=auth_headers,
    )
    vid = resp.json()["id"]
    calls: list = []
    _spy_commit(db_session, calls)
    resp = await async_client.patch(
        f"{BASE}/sessions/{sid}/versions/{vid}",
        json={"label": "milestone"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert calls == []
    assert resp.json()["label"] == "milestone"


async def test_delete_version_route_does_not_commit(async_client, db_session, auth_headers):
    sid = await _make_session(async_client, auth_headers)
    resp = await async_client.post(
        f"{BASE}/sessions/{sid}/versions",
        json={"edited_html": "<p>v1</p>"},
        headers=auth_headers,
    )
    vid = resp.json()["id"]
    calls: list = []
    _spy_commit(db_session, calls)
    resp = await async_client.delete(
        f"{BASE}/sessions/{sid}/versions/{vid}", headers=auth_headers
    )
    assert resp.status_code == 204, resp.text
    assert calls == []


async def test_rollback_undoes_uncommitted_session(async_client, db_session, auth_headers):
    sid = uuid.UUID(await _make_session(async_client, auth_headers))
    assert await db_session.get(GeneratorSession, sid) is not None
    await db_session.rollback()
    assert await db_session.get(GeneratorSession, sid) is None
