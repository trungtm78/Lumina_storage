import asyncio
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from src.models.processing import BackgroundTask


async def ping_task(ctx: dict, task_id: uuid.UUID) -> dict:
    session_factory = ctx["session_factory"]
    async with session_factory() as db:
        task = await db.get(BackgroundTask, task_id)
        if task is None:
            return {"error": "task not found"}

        task.status = "running"
        task.started_at = datetime.now(timezone.utc)
        await db.commit()

        # Actual work
        result = {"message": "pong", "task_id": str(task_id)}

        task.status = "success"
        task.completed_at = datetime.now(timezone.utc)
        task.result = result
        await db.commit()

    return result


async def long_running_task(ctx: dict, task_id: uuid.UUID, seconds: int = 5) -> dict:
    session_factory = ctx["session_factory"]
    async with session_factory() as db:
        task = await db.get(BackgroundTask, task_id)
        if task is None:
            return {"error": "task not found"}

        task.status = "running"
        task.started_at = datetime.now(timezone.utc)
        await db.commit()

    await asyncio.sleep(seconds)

    async with session_factory() as db:
        task = await db.get(BackgroundTask, task_id)
        if task is None:
            return {"error": "task not found"}

        result = {"message": f"slept for {seconds}s", "task_id": str(task_id)}
        task.status = "success"
        task.completed_at = datetime.now(timezone.utc)
        task.result = result
        await db.commit()

    return result
