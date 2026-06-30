import uuid

from arq import ArqRedis
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import CurrentUser
from src.core.authz import is_admin
from src.core.database import get_db
from src.models.processing import BackgroundTask
from src.worker.dispatch import dispatch_task

router = APIRouter(prefix="/tasks", tags=["tasks"])


def get_arq_pool(request: Request) -> ArqRedis:
    return request.app.state.arq_pool


@router.post("/ping", status_code=202)
async def ping(
    current_user: CurrentUser,
    arq_pool: ArqRedis = Depends(get_arq_pool),
    db: AsyncSession = Depends(get_db),
) -> dict:
    task = await dispatch_task(
        arq_pool=arq_pool,
        func_name="ping_task",
        task_name="ping",
        db=db,
        owner_id=current_user.id,
    )
    return {
        "id": str(task.id),
        "job_id": task.job_id,
        "status": task.status,
        "task_name": task.task_name,
        "created_at": task.created_at,
    }


@router.get("")
async def list_tasks(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(None),
    task_name: str | None = Query(None),
) -> dict:
    base_q = select(BackgroundTask)
    if not is_admin(current_user):
        base_q = base_q.where(BackgroundTask.owner_id == current_user.id)
    if status:
        base_q = base_q.where(BackgroundTask.status == status)
    if task_name:
        base_q = base_q.where(BackgroundTask.task_name == task_name)

    total_result = await db.execute(
        select(func.count()).select_from(base_q.subquery())
    )
    total = total_result.scalar_one()

    items_result = await db.execute(
        base_q.order_by(BackgroundTask.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    tasks = items_result.scalars().all()

    return {
        "items": [
            {
                "id": str(t.id),
                "job_id": t.job_id,
                "task_name": t.task_name,
                "status": t.status,
                "result": t.result,
                "error_message": t.error_message,
                "related_type": t.related_type,
                "related_id": str(t.related_id) if t.related_id else None,
                "created_at": t.created_at,
                "started_at": t.started_at,
                "completed_at": t.completed_at,
            }
            for t in tasks
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{task_id}")
async def get_task(
    task_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> dict:
    task = await db.get(BackgroundTask, task_id)
    # Non-admin chỉ đọc được task của chính mình. Trả 404 (không 403) để không
    # lộ sự tồn tại của task người khác.
    if task is None or (not is_admin(current_user) and task.owner_id != current_user.id):
        raise HTTPException(status_code=404, detail="Task not found")
    return {
        "id": str(task.id),
        "job_id": task.job_id,
        "task_name": task.task_name,
        "status": task.status,
        "result": task.result,
        "error_message": task.error_message,
        "created_at": task.created_at,
        "started_at": task.started_at,
        "completed_at": task.completed_at,
    }
