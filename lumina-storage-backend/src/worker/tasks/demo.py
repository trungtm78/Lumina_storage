import asyncio
import uuid
from datetime import datetime, timezone

from src.worker.tasks.document import mark_ingest_status


async def ping_task(ctx: dict, task_id: uuid.UUID) -> dict:
    """Demo task: vòng đời status. Phase 3 T5: checkpoint qua mark_ingest_status (session riêng)."""
    session_factory = ctx["session_factory"]
    await mark_ingest_status(session_factory, task_id, "running", started_at=datetime.now(timezone.utc))

    result = {"message": "pong", "task_id": str(task_id)}

    await mark_ingest_status(
        session_factory, task_id, "success",
        completed_at=datetime.now(timezone.utc), result=result,
    )
    return result


async def long_running_task(ctx: dict, task_id: uuid.UUID, seconds: int = 5) -> dict:
    session_factory = ctx["session_factory"]
    await mark_ingest_status(session_factory, task_id, "running", started_at=datetime.now(timezone.utc))

    await asyncio.sleep(seconds)

    result = {"message": f"slept for {seconds}s", "task_id": str(task_id)}
    await mark_ingest_status(
        session_factory, task_id, "success",
        completed_at=datetime.now(timezone.utc), result=result,
    )
    return result
