"""Phase 4 T4 — Langfuse flush NON-BLOCK: aflush() dùng httpx.AsyncClient + fire_and_forget_flush
spawn task (giữ ref tránh GC), KHÔNG block response. Trace best-effort (mất khi process chết OK).
"""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.ai.tracing import fire_and_forget_flush
from src.core.langfuse import LangfuseHTTPHandler



def _handler():
    h = LangfuseHTTPHandler(public_key="p", secret_key="s", host="http://lf")
    h._events = [{"id": "e1"}]
    return h


@pytest.mark.asyncio
async def test_aflush_uses_async_client_not_sync_post():
    h = _handler()
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=SimpleNamespace(status_code=200, text=""))
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    with patch("httpx.AsyncClient", return_value=mock_client), patch("httpx.post") as sync_post:
        await h.aflush()
    mock_client.post.assert_awaited_once()
    sync_post.assert_not_called()        # KHÔNG block bằng sync httpx.post
    assert h._events == []               # đã clear


@pytest.mark.asyncio
async def test_aflush_swallows_errors():
    h = _handler()
    with patch("httpx.AsyncClient", side_effect=RuntimeError("net down")):
        await h.aflush()  # KHÔNG raise
    assert h._events == []


@pytest.mark.asyncio
async def test_aflush_noop_when_empty():
    h = LangfuseHTTPHandler(public_key="p", secret_key="s", host="http://lf")
    h._events = []  # __init__ tự tạo trace-create event → clear để test nhánh rỗng
    with patch("httpx.AsyncClient") as ac:
        await h.aflush()
    ac.assert_not_called()


@pytest.mark.asyncio
async def test_fire_and_forget_does_not_block():
    done = asyncio.Event()

    class _H:
        async def aflush(self):
            await asyncio.sleep(0.05)
            done.set()

    fire_and_forget_flush(_H())
    # Trả ngay — aflush CHƯA xong (không block response).
    assert not done.is_set()
    await asyncio.sleep(0.12)
    assert done.is_set()  # task vẫn chạy đến cùng (ref được giữ, không bị GC)


@pytest.mark.asyncio
async def test_fire_and_forget_none_handler_noop():
    fire_and_forget_flush(None)  # KHÔNG lỗi


@pytest.mark.asyncio
async def test_pending_set_discarded_after_completion():
    # /codex T4 P3: task hoàn tất → ref bị discard khỏi _PENDING_FLUSHES (không leak).
    from src.ai.tracing import _PENDING_FLUSHES

    class _H:
        async def aflush(self):
            return None

    fire_and_forget_flush(_H())
    assert len(_PENDING_FLUSHES) >= 1
    await asyncio.sleep(0.02)
    assert len(_PENDING_FLUSHES) == 0  # discard qua done-callback


def test_sync_fallback_calls_flush_when_no_loop():
    # /codex T4 P3: không có running loop (sync context) → gọi flush() đồng bộ.
    called = {"flush": False}

    class _H:
        def flush(self):
            called["flush"] = True

    fire_and_forget_flush(_H())  # gọi từ sync test (không event loop) → fallback
    assert called["flush"] is True
