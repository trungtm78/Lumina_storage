import hashlib
import logging
import uuid
from typing import Any

from arq import ArqRedis
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.processing import BackgroundTask

logger = logging.getLogger(__name__)


def _dedupe_job_id(func_name: str, related_id: uuid.UUID | None) -> str | None:
    """Stable arq job_id so re-enqueuing the same (task, target) is a no-op while
    a prior instance is still queued or running. ARQ short-circuits on collision."""
    if related_id is None:
        return None
    digest = hashlib.sha256(f"{func_name}:{related_id}".encode()).hexdigest()
    return digest[:24]


async def dispatch_task(
    arq_pool: ArqRedis,
    func_name: str,
    task_name: str,
    db: AsyncSession,
    owner_id: uuid.UUID | None = None,
    related_type: str | None = None,
    related_id: uuid.UUID | None = None,
    dedupe: bool = True,
    **kwargs: Any,
) -> BackgroundTask:
    record = BackgroundTask(
        task_name=task_name,
        status="pending",
        owner_id=owner_id,
        related_type=related_type,
        related_id=related_id,
    )
    db.add(record)
    await db.flush()  # populate record.id

    # Phase 3 T4 — COMMIT TRƯỚC ENQUEUE (cố ý): record (status="pending") + mọi business
    # data đang pending trên session phải BỀN trước khi enqueue, để worker (đọc record.id
    # qua Redis→DB) luôn thấy. Tách 2 transaction: (a) ghi+commit data, (b) enqueue.
    await db.commit()
    await db.refresh(record)

    enqueue_kwargs = dict(kwargs)
    if dedupe:
        job_id = _dedupe_job_id(func_name, related_id)
        if job_id:
            enqueue_kwargs["_job_id"] = job_id

    try:
        job = await arq_pool.enqueue_job(func_name, record.id, **enqueue_kwargs)
    except Exception:
        # Data đã commit nhưng enqueue lỗi (Redis down…) → giữ status="pending"
        # (recoverable) + log; KHÔNG raise để không làm hỏng request. Reconciliation/
        # retry để sau (Phase 3 KHÔNG làm outbox).
        logger.warning(
            "dispatch_task: enqueue '%s' failed for record %s — status pending (recoverable)",
            func_name, record.id, exc_info=True,
        )
        return record

    if job is not None:
        record.job_id = job.job_id
        # Phase 3 T4: commit lần 2 chỉ để lưu job_id sau khi enqueue thành công.
        await db.commit()
        await db.refresh(record)
    return record
