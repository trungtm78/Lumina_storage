import logging
import uuid
from typing import Any

from arq import ArqRedis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.processing import BackgroundTask

logger = logging.getLogger(__name__)

_INFLIGHT = ("pending", "running")


async def _find_inflight(
    db: AsyncSession, task_name: str, related_id: uuid.UUID
) -> BackgroundTask | None:
    """Task đang chạy/chờ (pending/running) cho cùng (task_name, related_id), nếu có."""
    result = await db.execute(
        select(BackgroundTask)
        .where(
            BackgroundTask.task_name == task_name,
            BackgroundTask.related_id == related_id,
            BackgroundTask.status.in_(_INFLIGHT),
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


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
    # Phase 8 T1 — DEDUPE theo IN-FLIGHT TASK (không phải arq stable job_id). Trước đây
    # _dedupe_job_id ổn định + arq keep_result=3600 giữ id job đã xong 1h → re-ingest sau
    # khi xong/lỗi bị enqueue_job trả None → NUỐT im lặng. Giờ: nếu đã có task in-flight
    # cho (task_name, related_id) → trả lại task đó (dedupe đúng). Khi task cũ đã success/
    # failure → KHÔNG còn in-flight → re-ingest tạo task mới + enqueue.
    if dedupe and related_id is not None:
        existing = await _find_inflight(db, task_name, related_id)
        if existing is not None:
            return existing

    # Phase 8 T3: bắt correlation/request-id của request hiện tại → lưu vào record để worker
    # set lại vào ContextVar (nối chuỗi trace API→job). Rỗng nếu dispatch ngoài HTTP context.
    from asgi_correlation_id.context import correlation_id
    request_id = correlation_id.get()

    record = BackgroundTask(
        task_name=task_name,
        status="pending",
        owner_id=owner_id,
        related_type=related_type,
        related_id=related_id,
        request_id=request_id,
    )
    db.add(record)
    try:
        await db.flush()  # populate record.id; partial-unique bắt race concurrent
    except IntegrityError:
        # 2 request đồng thời cùng vượt qua _find_inflight rồi cùng insert → partial unique
        # index uq_backgroundtask_inflight vi phạm (atomic). Rollback + trả task kia (request
        # đầu thắng). Diệt TOCTOU → chỉ 1 in-flight job/document (tránh clobber active_ingest_version).
        await db.rollback()
        if dedupe and related_id is not None:
            existing = await _find_inflight(db, task_name, related_id)
            if existing is not None:
                return existing
        raise

    # Phase 3 T4 — COMMIT TRƯỚC ENQUEUE (cố ý): record (status="pending") + mọi business
    # data đang pending trên session phải BỀN trước khi enqueue, để worker (đọc record.id
    # qua Redis→DB) luôn thấy. Tách 2 transaction: (a) ghi+commit data, (b) enqueue.
    await db.commit()
    await db.refresh(record)

    # Job id UNIQUE per dispatch (str(record.id)) → KHÔNG đụng stale result của job đã xong
    # (nguồn gốc bug nuốt cũ). Dedupe concurrency đã do in-flight check + partial-unique lo.
    enqueue_kwargs = dict(kwargs)

    try:
        job = await arq_pool.enqueue_job(
            func_name, record.id, _job_id=str(record.id), **enqueue_kwargs
        )
    except Exception:
        # Data đã commit nhưng enqueue lỗi (Redis down…) → giữ status="pending"
        # (recoverable) + log; KHÔNG raise để không làm hỏng request.
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
