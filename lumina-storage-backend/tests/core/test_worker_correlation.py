"""Phase 8 T3 — correlation/request-id propagate API→worker."""
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from asgi_correlation_id.context import correlation_id
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.models.processing import BackgroundTask
from src.worker.dispatch import dispatch_task
from src.worker.tasks.document import mark_ingest_status

pytestmark = pytest.mark.asyncio


async def test_dispatch_captures_request_id(db_session):
    async def enqueue(*a, **k):
        return SimpleNamespace(job_id=k.get("_job_id", "j"))
    token = correlation_id.set("req-abc")
    try:
        rec = await dispatch_task(
            SimpleNamespace(enqueue_job=enqueue),
            "ingest_document_task", "ingest", db_session,
            related_type="document", related_id=uuid.uuid4(),
        )
        assert rec.request_id == "req-abc"
    finally:
        correlation_id.reset(token)


async def test_mark_running_sets_correlation_context(test_engine):
    sf = async_sessionmaker(test_engine, expire_on_commit=False)
    async with sf() as s:
        bg = BackgroundTask(task_name="ingest", status="pending",
                            related_type="document", request_id="req-xyz")
        s.add(bg)
        await s.commit()
        tid = bg.id

    correlation_id.set(None)  # đảm bảo chưa có
    await mark_ingest_status(sf, tid, "running", started_at=datetime.now(timezone.utc))
    assert correlation_id.get() == "req-xyz"  # context đã được set từ record

    async with sf() as s:
        obj = await s.get(BackgroundTask, tid)
        if obj:
            await s.delete(obj)
        await s.commit()
