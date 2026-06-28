"""Task 3.4 / T4 (commit-trước-enqueue) — dispatch_task phải COMMIT data TRƯỚC khi
enqueue, và enqueue lỗi KHÔNG được làm hỏng request (giữ status='pending' recoverable).

Bất biến:
1. Ordering: `db.commit()` gọi TRƯỚC `arq_pool.enqueue_job()` → worker (đọc record.id
   qua Redis→DB) luôn thấy record + business data đã commit (chống race "not found").
2. Enqueue-failure: nếu enqueue ném lỗi (Redis down…) SAU khi data đã commit → KHÔNG
   raise; record giữ status='pending' (recoverable) + log. (Phase 3 NOT outbox.)
"""
from types import SimpleNamespace

import pytest

from src.models.processing import BackgroundTask
from src.worker.dispatch import dispatch_task

pytestmark = pytest.mark.asyncio


async def test_dispatch_commits_before_enqueue(db_session, test_user):
    events: list[str] = []
    orig_commit = db_session.commit

    async def spy_commit():
        events.append("commit")
        return await orig_commit()

    db_session.commit = spy_commit

    async def fake_enqueue(*_a, **_k):
        events.append("enqueue")
        return SimpleNamespace(job_id="job-1")

    arq = SimpleNamespace(enqueue_job=fake_enqueue)

    rec = await dispatch_task(
        arq,
        "ingest_document_task",
        "ingest",
        db_session,
        owner_id=test_user.id,
        related_type="document",
        related_id=test_user.id,
    )

    assert "commit" in events and "enqueue" in events
    # COMMIT phải xảy ra TRƯỚC enqueue đầu tiên.
    assert events.index("commit") < events.index("enqueue")
    assert rec.status == "pending"
    assert rec.job_id == "job-1"


async def test_dispatch_enqueue_failure_keeps_pending(db_session, test_user):
    async def boom(*_a, **_k):
        raise RuntimeError("redis down")

    arq = SimpleNamespace(enqueue_job=boom)

    # KHÔNG raise dù enqueue lỗi.
    rec = await dispatch_task(
        arq,
        "ingest_document_task",
        "ingest",
        db_session,
        owner_id=test_user.id,
        related_type="document",
        related_id=test_user.id,
    )

    assert rec.status == "pending"
    assert rec.job_id is None
    # Record đã commit (bền) trước khi enqueue lỗi → vẫn truy vấn được.
    assert await db_session.get(BackgroundTask, rec.id) is not None


async def test_dispatch_commits_pending_business_data_before_enqueue(db_session, test_user):
    """Commit của dispatch_task gom CẢ business data pending trên session, TRƯỚC enqueue."""
    from src.models.core import AuditLog

    audit = AuditLog(
        user_id=test_user.id,
        action="document.upload",
        resource_type="document",
        resource_id=test_user.id,
    )
    db_session.add(audit)  # business data pending, CHƯA commit

    seen: list = []

    async def fake_enqueue(*_a, **_k):
        # Tại thời điểm enqueue, business data phải đã được commit (đọc được).
        seen.append(await db_session.get(AuditLog, audit.id) is not None)
        return SimpleNamespace(job_id="j")

    arq = SimpleNamespace(enqueue_job=fake_enqueue)
    await dispatch_task(
        arq, "ingest_document_task", "ingest", db_session,
        owner_id=test_user.id, related_type="document", related_id=test_user.id,
    )
    assert seen == [True]


async def test_dispatch_job_none_dedupe_collision_keeps_pending(db_session, test_user):
    """ARQ dedupe collision → enqueue_job trả None: record vẫn bền, status pending, job_id None."""
    async def none_enqueue(*_a, **_k):
        return None

    arq = SimpleNamespace(enqueue_job=none_enqueue)
    rec = await dispatch_task(
        arq, "ingest_document_task", "ingest", db_session,
        owner_id=test_user.id, related_type="document", related_id=test_user.id,
    )
    assert rec.job_id is None
    assert rec.status == "pending"
    assert await db_session.get(BackgroundTask, rec.id) is not None
