"""Phase 8 T2 — DLQ reconcile: task kẹt 'running' do crash → cron đánh 'failure'."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.models.processing import BackgroundTask
from src.worker.tasks.reconcile import reconcile_stale_tasks

pytestmark = pytest.mark.asyncio


async def test_reconcile_marks_stale_running_failure(test_engine):
    sf = async_sessionmaker(test_engine, expire_on_commit=False)
    old = datetime.now(timezone.utc) - timedelta(hours=2)  # quá 1h ngưỡng
    recent = datetime.now(timezone.utc) - timedelta(minutes=5)
    async with sf() as s:
        stale = BackgroundTask(task_name="ingest", status="running",
                               related_type="document", started_at=old)
        fresh = BackgroundTask(task_name="ingest", status="running",
                               related_type="document", started_at=recent)
        s.add_all([stale, fresh])
        await s.commit()
        stale_id, fresh_id = stale.id, fresh.id

    out = await reconcile_stale_tasks({"session_factory": sf})
    assert out["reconciled"] >= 1

    async with sf() as s:
        assert (await s.get(BackgroundTask, stale_id)).status == "failure"
        assert (await s.get(BackgroundTask, fresh_id)).status == "running"  # còn hạn → giữ
        # cleanup (session thật, không savepoint)
        for tid in (stale_id, fresh_id):
            obj = await s.get(BackgroundTask, tid)
            if obj:
                await s.delete(obj)
        await s.commit()
