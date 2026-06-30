"""Phase 8 T2 — DLQ reconcile: gỡ BackgroundTask kẹt 'running' do worker crash/kill.

ingest/extract task đã tự đánh 'failure' trước khi raise (mọi exception) → KHÔNG kẹt khi
lỗi thường. Chỉ HARD CRASH (process bị kill giữa chừng, except handler không chạy) mới để
status kẹt 'running' → in-flight dedup (T1) chặn re-ingest vĩnh viễn. Cron này quét task
'running' quá lâu (> 2× job_timeout) → đánh 'failure' (DLQ) để gỡ kẹt + lộ ra cho re-ingest.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from src.models.processing import BackgroundTask

logger = logging.getLogger(__name__)

# 2× job_timeout (1800s) = 1h — an toàn quá mọi task hợp lệ (xlsx lớn ~30min).
_STALE_SECONDS = 3600


async def reconcile_stale_tasks(ctx: dict) -> dict:
    """Đánh 'failure' mọi BackgroundTask kẹt 'running' quá _STALE_SECONDS (worker crash)."""
    session_factory = ctx["session_factory"]
    threshold = datetime.now(timezone.utc) - timedelta(seconds=_STALE_SECONDS)
    async with session_factory() as s:
        result = await s.execute(
            update(BackgroundTask)
            .where(
                BackgroundTask.status == "running",
                BackgroundTask.started_at.is_not(None),
                BackgroundTask.started_at < threshold,
            )
            .values(
                status="failure",
                error_message="stale: worker crash/timeout (reconciled)",
                completed_at=datetime.now(timezone.utc),
            )
            .returning(BackgroundTask.id)
        )
        ids = [row[0] for row in result.all()]
        await s.commit()
    if ids:
        logger.warning("reconcile_stale_tasks: đánh failure %d task kẹt 'running': %s", len(ids), ids)
    return {"reconciled": len(ids)}
