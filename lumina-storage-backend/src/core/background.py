"""Fire-and-forget asyncio task GIỮ strong reference → tránh GC thu hồi task đang chạy.

Bug Python: asyncio CHỈ giữ weak ref tới task; nếu caller không giữ returned task, garbage
collector có thể huỷ task giữa chừng. Pattern này (set giữ ref + done-callback discard) y hệt
ai/tracing.py `_PENDING_FLUSHES`, nhưng dùng chung cho mọi background task (title-gen chat,
pre-gen PDF review, ...). Lỗi trong task được nuốt + log (fire-and-forget, KHÔNG nổ ra caller).
"""
import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

logger = logging.getLogger(__name__)

# Giữ strong ref các task đang chạy → chống asyncio GC huỷ giữa chừng.
_BACKGROUND_TASKS: set[asyncio.Task] = set()


def spawn_background(coro: Coroutine[Any, Any, Any], *, name: str | None = None) -> asyncio.Task:
    """Spawn `coro` ở background, GIỮ ref tới khi xong. Trả task (caller KHÔNG cần giữ).

    Yêu cầu có event loop đang chạy (gọi trong async context). Lỗi trong coro được log,
    KHÔNG propagate (fire-and-forget).
    """
    task = asyncio.ensure_future(coro)
    if name:
        try:
            task.set_name(name)
        except Exception:
            pass
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_on_task_done)
    return task


def _on_task_done(task: asyncio.Task) -> None:
    """Nhả ref + log nếu task lỗi (đồng thời retrieve exception để asyncio không cảnh báo
    'Task exception was never retrieved')."""
    _BACKGROUND_TASKS.discard(task)
    if not task.cancelled():
        exc = task.exception()
        if exc is not None:
            logger.warning("Background task '%s' lỗi", task.get_name(), exc_info=exc)
