"""Phase 4 T4 — tracing helper: flush Langfuse KHÔNG block response.

`fire_and_forget_flush` spawn task `aflush()` (httpx.AsyncClient) qua asyncio.create_task,
GIỮ reference (C5 — tránh asyncio GC thu hồi task đang chạy). Trace là best-effort:
mất khi process chết (deploy/OOM) là CHẤP NHẬN cho observability.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)

# Giữ reference các task flush đang chạy → tránh bị garbage-collect giữa chừng (bug Python:
# asyncio chỉ giữ weak ref tới task; mất ref → task có thể bị huỷ).
_PENDING_FLUSHES: set[asyncio.Task] = set()


def fire_and_forget_flush(handler) -> None:
    """Flush handler ở background, KHÔNG await (response không bị block).

    Không có event loop đang chạy (sync context) → fallback flush đồng bộ.
    """
    if handler is None:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # Sync context (vd test/script) → flush đồng bộ best-effort.
        try:
            handler.flush()
        except Exception:
            logger.warning("Langfuse sync flush failed", exc_info=True)
        return

    task = loop.create_task(handler.aflush())
    _PENDING_FLUSHES.add(task)
    task.add_done_callback(_on_flush_done)


def _on_flush_done(task: asyncio.Task) -> None:
    """Discard ref + log nếu task lỗi bất ngờ (aflush đã nuốt lỗi nội bộ; đây là safety net
    cho exception ngoài dự kiến — /codex T4 P2)."""
    _PENDING_FLUSHES.discard(task)
    if not task.cancelled():
        exc = task.exception()
        if exc is not None:
            logger.warning("Langfuse aflush task error", exc_info=exc)
