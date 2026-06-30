import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, require_admin
from src.core.database import get_db
from src.models.user import User
from src.domain.identity.group import GroupService
from src.schemas.group import GroupResponse
from src.schemas.user import (
    AdminUserUpdateRequest,
    MenuPermissionResponse,
    RoleCreateRequest,
    RoleMemberRequest,
    RoleMenuPermissionsUpdateRequest,
    RoleResponse,
    RoleUpdateRequest,
    UserPasswordChangeRequest,
    UserPreferenceResponse,
    UserPreferenceUpdateRequest,
    UserResponse,
)
from src.domain.identity.user import UserService

router = APIRouter(tags=["users"])


class UserSearchResult(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str
    avatar: Optional[str] = None


def get_user_service(db: AsyncSession = Depends(get_db)) -> UserService:
    return UserService(db)


# ── Users ────────────────────────────────────────────────────────────────────

@router.get("/users/search", response_model=list[UserSearchResult])
async def search_users(
    q: str = Query(default=""),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[UserSearchResult]:
    """Search active users by name or email for sharing purposes."""
    conditions = [User.is_active == True, User.id != current_user.id]
    if q:
        conditions.append(or_(
            User.full_name.ilike(f"%{q}%"),
            User.email.ilike(f"%{q}%"),
        ))
    result = await db.execute(
        select(User.id, User.full_name, User.email, User.avatar)
        .where(*conditions)
        .order_by(User.full_name)
        .limit(20)
    )
    return [UserSearchResult(id=row.id, full_name=row.full_name, email=row.email, avatar=row.avatar) for row in result]


@router.get("/users", response_model=dict)
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    role_id: list[uuid.UUID] = Query(default=[]),
    group_id: list[uuid.UUID] = Query(default=[]),
    is_active: bool | None = Query(None),
    current_user: User = Depends(require_admin),
    svc: UserService = Depends(get_user_service),
) -> dict:
    items, total = await svc.list_users(page, page_size, search, role_id, group_id, is_active)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/users/me/preferences", response_model=UserPreferenceResponse)
async def get_preferences(
    current_user: User = Depends(get_current_user),
    svc: UserService = Depends(get_user_service),
) -> UserPreferenceResponse:
    return await svc.get_preferences(current_user.id)


@router.patch("/users/me/preferences", response_model=UserPreferenceResponse)
async def update_preferences(
    data: UserPreferenceUpdateRequest,
    current_user: User = Depends(get_current_user),
    svc: UserService = Depends(get_user_service),
) -> UserPreferenceResponse:
    return await svc.update_preferences(current_user.id, data)


@router.post("/users/me/password", status_code=204)
async def change_password(
    data: UserPasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    svc: UserService = Depends(get_user_service),
) -> None:
    await svc.change_password(current_user.id, data)


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: UserService = Depends(get_user_service),
) -> UserResponse:
    return await svc.get_user(user_id)


@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: uuid.UUID,
    data: AdminUserUpdateRequest,
    current_user: User = Depends(get_current_user),
    svc: UserService = Depends(get_user_service),
) -> UserResponse:
    return await svc.update_user(user_id, data, current_user)


@router.delete("/users/{user_id}", status_code=204)
async def deactivate_user(
    user_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    svc: UserService = Depends(get_user_service),
) -> None:
    await svc.deactivate_user(user_id, current_user)


@router.delete("/users/{user_id}/permanent", status_code=204)
async def delete_user_permanently(
    user_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    svc: UserService = Depends(get_user_service),
) -> None:
    await svc.delete_user_permanently(user_id, current_user)


# ── Roles ────────────────────────────────────────────────────────────────────

@router.get("/roles", response_model=dict)
async def list_roles(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    svc: UserService = Depends(get_user_service),
) -> dict:
    items, total = await svc.list_roles(page, page_size, search)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/roles/{role_id}", response_model=RoleResponse)
async def get_role(
    role_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: UserService = Depends(get_user_service),
) -> RoleResponse:
    return await svc.get_role(role_id)


@router.post("/roles", response_model=RoleResponse, status_code=201)
async def create_role(
    data: RoleCreateRequest,
    current_user: User = Depends(require_admin),
    svc: UserService = Depends(get_user_service),
) -> RoleResponse:
    return await svc.create_role(data)


@router.patch("/roles/{role_id}", response_model=RoleResponse)
async def update_role(
    role_id: uuid.UUID,
    data: RoleUpdateRequest,
    current_user: User = Depends(require_admin),
    svc: UserService = Depends(get_user_service),
) -> RoleResponse:
    return await svc.update_role(role_id, data)


@router.delete("/roles/{role_id}", status_code=204)
async def delete_role(
    role_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    svc: UserService = Depends(get_user_service),
) -> None:
    await svc.delete_role(role_id)


@router.post("/roles/{role_id}/members", status_code=204)
async def add_member(
    role_id: uuid.UUID,
    data: RoleMemberRequest,
    current_user: User = Depends(require_admin),
    svc: UserService = Depends(get_user_service),
) -> None:
    await svc.add_member(role_id, data.user_id, current_user)


@router.delete("/roles/{role_id}/members/{user_id}", status_code=204)
async def remove_member(
    role_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    svc: UserService = Depends(get_user_service),
) -> None:
    await svc.remove_member(role_id, user_id)


@router.get("/roles/{role_id}/auto-group", response_model=GroupResponse | None)
async def get_auto_group_for_role(
    role_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GroupResponse | None:
    group = await GroupService(db).get_auto_group_by_role(role_id)
    if not group:
        return None
    return GroupResponse.model_validate(group)


# ── Menu Permissions ──────────────────────────────────────────────────────────

@router.get("/permissions/menu", response_model=list[MenuPermissionResponse])
async def list_menu_permissions(
    current_user: User = Depends(get_current_user),
    svc: UserService = Depends(get_user_service),
) -> list[MenuPermissionResponse]:
    return await svc.list_menu_permissions()


@router.get("/roles/{role_id}/menu-permissions", response_model=list[dict])
async def get_role_menu_permissions(
    role_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: UserService = Depends(get_user_service),
) -> list[dict]:
    return await svc.get_role_menu_permissions(role_id)


@router.put("/roles/{role_id}/menu-permissions", status_code=204)
async def set_role_menu_permissions(
    role_id: uuid.UUID,
    data: RoleMenuPermissionsUpdateRequest,
    current_user: User = Depends(require_admin),
    svc: UserService = Depends(get_user_service),
) -> None:
    await svc.set_role_menu_permissions(role_id, data)
