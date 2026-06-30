import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, require_admin
from src.core.database import get_db
from src.models.user import User
from src.schemas.group import GroupCreateRequest, GroupDetailResponse, GroupMemberRequest, GroupUpdateRequest
from src.domain.identity.group import GroupService

router = APIRouter(tags=["groups"])


def get_group_service(db: AsyncSession = Depends(get_db)) -> GroupService:
    return GroupService(db)


@router.get("/groups", response_model=dict)
async def list_groups(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    type: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    svc: GroupService = Depends(get_group_service),
) -> dict:
    items, total = await svc.list_groups(page, page_size, search, type)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.post("/groups", response_model=GroupDetailResponse, status_code=201)
async def create_group(
    data: GroupCreateRequest,
    current_user: User = Depends(require_admin),
    svc: GroupService = Depends(get_group_service),
) -> GroupDetailResponse:
    return await svc.create_group(data, current_user)


@router.get("/groups/{group_id}", response_model=GroupDetailResponse)
async def get_group(
    group_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: GroupService = Depends(get_group_service),
) -> GroupDetailResponse:
    return await svc.get_group(group_id)


@router.patch("/groups/{group_id}", response_model=GroupDetailResponse)
async def update_group(
    group_id: uuid.UUID,
    data: GroupUpdateRequest,
    current_user: User = Depends(require_admin),
    svc: GroupService = Depends(get_group_service),
) -> GroupDetailResponse:
    return await svc.update_group(group_id, data)


@router.delete("/groups/{group_id}", status_code=204)
async def delete_group(
    group_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    svc: GroupService = Depends(get_group_service),
) -> None:
    await svc.delete_group(group_id)


@router.get("/groups/{group_id}/members", response_model=dict)
async def get_group_members(
    group_id: uuid.UUID,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    svc: GroupService = Depends(get_group_service),
) -> dict:
    members, total = await svc.list_members(group_id, page, page_size, search)
    return {"items": members, "total": total, "page": page, "page_size": page_size}


@router.post("/groups/{group_id}/members", status_code=201)
async def add_group_member(
    group_id: uuid.UUID,
    data: GroupMemberRequest,
    current_user: User = Depends(require_admin),
    svc: GroupService = Depends(get_group_service),
) -> dict:
    await svc.add_member(group_id, data.user_id)
    return {}


@router.delete("/groups/{group_id}/members/{user_id}", status_code=204)
async def remove_group_member(
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    svc: GroupService = Depends(get_group_service),
) -> None:
    await svc.remove_member(group_id, user_id)
