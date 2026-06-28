"""Task 3.6 / T5 (worker UoW) — BẤT BIẾN quan trọng nhất Phase 3:

ingest lỗi giữa chừng → business mutation ROLLBACK, NHƯNG status='failure' VẪN ghi được
(checkpoint ở SESSION RIÊNG, sống qua business rollback).

`mark_ingest_status()` mở session độc lập + commit → không nằm trong transaction business.
`run_ingest_business` bọc `uow_context` (session riêng, một transaction); lỗi → rollback.

Test dùng session_factory THẬT từ test_engine (commit thật, không savepoint) để phản
ánh đúng ngữ nghĩa "session riêng". Dùng BackgroundTask vừa làm status-holder vừa làm
business-marker (tránh dựng Document + FK nặng). Tự dọn row đã tạo.
"""
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.core.uow import uow_context
from src.models.processing import BackgroundTask
from src.worker.tasks.document import mark_extract_status, mark_ingest_status

pytestmark = pytest.mark.asyncio

_MARKER = "T5_BUSINESS_MARKER"


async def test_failure_status_survives_business_rollback(test_engine):
    sf = async_sessionmaker(test_engine, expire_on_commit=False)

    # Seed một BackgroundTask status="running" (commit thật).
    async with sf() as s:
        bg = BackgroundTask(task_name="ingest", status="running")
        s.add(bg)
        await s.commit()
        tid = bg.id

    try:
        # Business: thêm một row marker rồi lỗi → uow_context rollback (marker biến mất).
        async with uow_context(sf) as uow:
            uow.session.add(BackgroundTask(task_name=_MARKER, status="x"))
            await uow.session.flush()
            raise RuntimeError("ingest boom")
    except RuntimeError:
        # Ghi failure ở SESSION RIÊNG — phải sống qua business rollback ở trên.
        await mark_ingest_status(sf, tid, "failure", error_message="ingest boom")

    async with sf() as s:
        bg2 = await s.get(BackgroundTask, tid)
        assert bg2 is not None and bg2.status == "failure"
        assert bg2.error_message == "ingest boom"
        markers = (
            await s.execute(select(BackgroundTask).where(BackgroundTask.task_name == _MARKER))
        ).scalars().all()
        # Business marker bị rollback → KHÔNG tồn tại (chứng minh business KHÔNG commit).
        assert markers == []

    # Dọn dẹp row test đã commit.
    async with sf() as s:
        await s.execute(delete(BackgroundTask).where(BackgroundTask.id == tid))
        await s.execute(delete(BackgroundTask).where(BackgroundTask.task_name == _MARKER))
        await s.commit()


async def test_mark_ingest_status_noop_when_task_missing(test_engine):
    import uuid

    sf = async_sessionmaker(test_engine, expire_on_commit=False)
    # task_id không tồn tại → no-op, KHÔNG raise.
    await mark_ingest_status(sf, uuid.uuid4(), "failure", error_message="x")


async def test_mark_extract_status_updates_bg_and_tolerates_missing_doc(test_engine):
    import uuid

    sf = async_sessionmaker(test_engine, expire_on_commit=False)
    async with sf() as s:
        bg = BackgroundTask(task_name="extract_template", status="running")
        s.add(bg)
        await s.commit()
        tid = bg.id

    # document_id không tồn tại → chỉ update bg, BỎ QUA metadata, KHÔNG crash (checkpoint
    # failure phải ghi được kể cả khi source doc đã bị xóa).
    await mark_extract_status(sf, tid, uuid.uuid4(), "failure", "failed", error_message="boom")

    async with sf() as s:
        bg2 = await s.get(BackgroundTask, tid)
        assert bg2 is not None and bg2.status == "failure" and bg2.error_message == "boom"

    async with sf() as s:
        await s.execute(delete(BackgroundTask).where(BackgroundTask.id == tid))
        await s.commit()
