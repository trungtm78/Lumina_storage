"""Test spawn_background GIỮ strong ref task → tránh asyncio GC thu hồi giữa chừng.

Bug (review ARCH-P2): chat_service title-gen + review _persist_pdf_bg dùng asyncio.create_task
KHÔNG giữ returned task → event loop có thể GC task trước khi xong (asyncio chỉ giữ weak ref).
"""
import asyncio

import pytest

pytestmark = pytest.mark.asyncio


async def test_spawn_background_retains_until_done():
    from src.core.background import _BACKGROUND_TASKS, spawn_background

    started = asyncio.Event()
    release = asyncio.Event()
    ran: list[int] = []

    async def work():
        started.set()
        await release.wait()
        ran.append(1)

    task = spawn_background(work())
    await started.wait()
    # Đang chạy → PHẢI được giữ ref (nếu không asyncio có thể GC).
    assert task in _BACKGROUND_TASKS
    release.set()
    await task
    # Xong → nhả ref (không leak set).
    assert task not in _BACKGROUND_TASKS
    assert ran == [1]


async def test_spawn_background_swallows_and_releases_on_error():
    from src.core.background import _BACKGROUND_TASKS, spawn_background

    async def boom():
        raise ValueError("kaboom")

    task = spawn_background(boom())
    # Lỗi không được nổ ra ngoài (fire-and-forget); ref được nhả; exception được retrieve.
    await asyncio.gather(task, return_exceptions=True)
    assert task not in _BACKGROUND_TASKS
    assert task.exception() is not None
