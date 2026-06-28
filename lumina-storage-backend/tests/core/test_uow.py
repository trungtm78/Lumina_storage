"""Task 3.1 (T1) — Unit of Work: commit/rollback boundary cho HTTP và ARQ.

UnitOfWork bao một AsyncSession: commit khi thoát sạch, rollback khi có exception,
xử lý rõ khi chính commit ném lỗi (rollback + propagate, không nuốt). `uow_context`
là boundary cho worker (tạo session từ factory). `get_uow` là dependency HTTP dùng
chung session của get_db.
"""
import uuid

import pytest

from src.core.uow import UnitOfWork, uow_context
from src.models.storage import StorageConfig

pytestmark = pytest.mark.asyncio


def _new_config(name: str) -> StorageConfig:
    return StorageConfig(
        id=uuid.uuid4(), name=name, backend_type="local",
        config={"base_dir": "/tmp/x"}, is_default=False, is_active=True,
    )


async def test_commit_on_clean_exit(db_session):
    cfg = _new_config("uow-commit")
    async with UnitOfWork(db_session) as uow:
        uow.session.add(cfg)
    # Thoát sạch → committed; row truy vấn được trong session
    found = await db_session.get(StorageConfig, cfg.id)
    assert found is not None


async def test_rollback_on_exception(db_session):
    cfg = _new_config("uow-rollback")
    cfg_id = cfg.id
    with pytest.raises(RuntimeError):
        async with UnitOfWork(db_session) as uow:
            uow.session.add(cfg)
            await uow.flush()
            raise RuntimeError("boom giữa chừng")
    # Exception → rollback toàn bộ; row không tồn tại
    found = await db_session.get(StorageConfig, cfg_id)
    assert found is None


async def test_manual_commit(db_session):
    cfg = _new_config("uow-manual")
    async with UnitOfWork(db_session) as uow:
        uow.session.add(cfg)
        await uow.commit()  # commit tường minh (cho commit-trước-enqueue)
        # sau commit thủ công, row đã bền
        assert await db_session.get(StorageConfig, cfg.id) is not None


async def test_commit_failure_rolls_back_and_propagates():
    """Nếu commit() ném lỗi ở __aexit__ → rollback + propagate, không nuốt lỗi."""
    calls: list[str] = []

    class FakeSession:
        async def commit(self):
            calls.append("commit")
            raise RuntimeError("commit failed")

        async def rollback(self):
            calls.append("rollback")

    with pytest.raises(RuntimeError, match="commit failed"):
        async with UnitOfWork(FakeSession()):
            pass
    assert calls == ["commit", "rollback"]


async def test_commit_failure_preserves_original_error_when_rollback_also_fails():
    """rollback cũng lỗi → vẫn propagate lỗi COMMIT gốc, không bị che."""
    class FakeSession:
        async def commit(self):
            raise RuntimeError("original commit error")

        async def rollback(self):
            raise RuntimeError("rollback masking error")

    with pytest.raises(RuntimeError, match="original commit error"):
        async with UnitOfWork(FakeSession()):
            pass


async def test_uow_context_commits(test_engine):
    """uow_context (boundary worker) tạo session từ factory, commit khi thoát sạch."""
    from sqlalchemy.ext.asyncio import async_sessionmaker
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    cfg = _new_config("uow-ctx")
    async with uow_context(factory) as uow:
        uow.session.add(cfg)
    # Session mới đọc lại → đã commit (bền thật, ngoài savepoint fixture)
    async with factory() as verify:
        found = await verify.get(StorageConfig, cfg.id)
        assert found is not None
        # cleanup (uow_context commit thật, không có outer rollback)
        await verify.delete(found)
        await verify.commit()


async def test_uow_context_rolls_back_on_exception(test_engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    cfg = _new_config("uow-ctx-rb")
    cfg_id = cfg.id
    with pytest.raises(RuntimeError):
        async with uow_context(factory) as uow:
            uow.session.add(cfg)
            await uow.flush()
            raise RuntimeError("boom")
    async with factory() as verify:
        assert await verify.get(StorageConfig, cfg_id) is None
