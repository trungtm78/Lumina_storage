import hashlib
import uuid
from typing import Any

from arq import ArqRedis
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.processing import BackgroundTask


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
    await db.flush()  # populate record.id without committing

    enqueue_kwargs = dict(kwargs)
    if dedupe:
        job_id = _dedupe_job_id(func_name, related_id)
        if job_id:
            enqueue_kwargs["_job_id"] = job_id

    job = await arq_pool.enqueue_job(func_name, record.id, **enqueue_kwargs)
    if job is not None:
        record.job_id = job.job_id

    await db.commit()
    await db.refresh(record)
    return record
