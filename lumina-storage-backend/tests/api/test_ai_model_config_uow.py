"""Task 3.3/T3 (domain AI Model Config) — service KHÔNG tự commit nữa.

Phase 3: commit gom về boundary (get_db cuối request). AIModelConfigService.* chỉ
flush; không gọi self.db.commit(). Test spy commit để chốt bất biến + happy-path
(dữ liệu vẫn flush, đọc được trong cùng transaction → response đúng).
"""
import pytest

from src.schemas.ai_model_config import AIModelConfigCreateRequest, AIModelConfigUpdateRequest
from src.services.ai_model_config_service import AIModelConfigService

pytestmark = pytest.mark.asyncio


def _create_req(name="m1", is_default=False) -> AIModelConfigCreateRequest:
    return AIModelConfigCreateRequest(
        name=name, provider="openai", model_name="gpt-4o",
        purpose="chat", api_key="sk-x", is_default=is_default,
    )


def _spy_commit(db_session, calls: list):
    orig = db_session.commit

    async def spy():
        calls.append(1)
        return await orig()

    db_session.commit = spy
    return orig


async def test_create_does_not_commit(db_session):
    calls: list = []
    _spy_commit(db_session, calls)
    svc = AIModelConfigService(db_session)
    resp = await svc.create(_create_req("create-nocommit"))
    assert calls == []  # service không commit; boundary mới commit
    # nhưng dữ liệu đã flush → đọc lại trong cùng transaction được
    assert await svc.repo.get_by_id(resp.id) is not None


async def test_update_does_not_commit(db_session):
    svc = AIModelConfigService(db_session)
    created = await svc.create(_create_req("update-nocommit"))
    calls: list = []
    _spy_commit(db_session, calls)
    updated = await svc.update(created.id, AIModelConfigUpdateRequest(name="renamed"))
    assert calls == []
    assert updated.name == "renamed"


async def test_delete_does_not_commit(db_session):
    svc = AIModelConfigService(db_session)
    created = await svc.create(_create_req("delete-nocommit"))
    calls: list = []
    _spy_commit(db_session, calls)
    await svc.delete(created.id)
    assert calls == []


async def test_set_default_does_not_commit(db_session):
    svc = AIModelConfigService(db_session)
    created = await svc.create(_create_req("setdefault-nocommit"))
    calls: list = []
    _spy_commit(db_session, calls)
    res = await svc.set_default(created.id)
    assert calls == []
    assert res.is_default is True


async def test_rollback_undoes_uncommitted_create(db_session):
    """Vì service không commit, rollback boundary hoàn tác toàn bộ (không partial)."""
    svc = AIModelConfigService(db_session)
    created = await svc.create(_create_req("rollback-me"))
    cfg_id = created.id
    await db_session.rollback()
    assert await svc.repo.get_by_id(cfg_id) is None
