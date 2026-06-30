"""Phase 8 T1 — dedupe theo IN-FLIGHT task: re-ingest sau khi job xong KHÔNG bị nuốt.

Bug cũ: arq stable job_id + keep_result=3600 → re-ingest trong 1h sau completion bị
enqueue_job trả None → nuốt. Giờ dedupe dựa BackgroundTask in-flight (pending/running).
"""
import uuid
from types import SimpleNamespace

import pytest

from src.models.processing import BackgroundTask
from src.worker.dispatch import dispatch_task

pytestmark = pytest.mark.asyncio


def _arq(calls: list):
    async def enqueue(*a, **k):
        calls.append((a, k))
        return SimpleNamespace(job_id=k.get("_job_id", "j"))
    return SimpleNamespace(enqueue_job=enqueue)


async def _seed(db, related_id, status):
    rec = BackgroundTask(task_name="ingest", status=status,
                         related_type="document", related_id=related_id)
    db.add(rec)
    await db.commit()
    return rec


async def test_inflight_running_returns_existing_no_enqueue(db_session):
    rid = uuid.uuid4()
    seeded = await _seed(db_session, rid, "running")
    calls: list = []
    rec = await dispatch_task(_arq(calls), "ingest_document_task", "ingest", db_session,
                              related_type="document", related_id=rid)
    assert rec.id == seeded.id          # trả task đang chạy (dedupe)
    assert calls == []                  # KHÔNG enqueue mới


async def test_completed_task_reingests_not_swallowed(db_session):
    rid = uuid.uuid4()
    done = await _seed(db_session, rid, "success")
    calls: list = []
    rec = await dispatch_task(_arq(calls), "ingest_document_task", "ingest", db_session,
                              related_type="document", related_id=rid)
    assert rec.id != done.id            # TẠO task mới (KHÔNG nuốt — bug cũ)
    assert rec.status == "pending" and rec.job_id is not None
    assert len(calls) == 1              # enqueue đã chạy
    # job_id UNIQUE = str(record.id) → không đụng stale result
    assert calls[0][1]["_job_id"] == str(rec.id)


async def test_failed_task_reingests(db_session):
    rid = uuid.uuid4()
    failed = await _seed(db_session, rid, "failure")
    calls: list = []
    rec = await dispatch_task(_arq(calls), "ingest_document_task", "ingest", db_session,
                              related_type="document", related_id=rid)
    assert rec.id != failed.id and len(calls) == 1
