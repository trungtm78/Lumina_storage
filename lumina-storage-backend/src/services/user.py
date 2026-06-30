import uuid

from sqlalchemy import delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.authz import is_admin
from src.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from src.core.security import hash_password, verify_password
from src.models.user import User
from src.repositories.group import GroupRepository
from src.repositories.role import RoleRepository
from src.repositories.permission import MenuPermissionRepository
from src.repositories.user import UserRepository
from src.schemas.user import (
    AdminUserUpdateRequest,
    GroupBriefResponse,
    MenuPermissionResponse,
    RoleCreateRequest,
    RoleMenuPermissionsUpdateRequest,
    RoleMenuPermissionResponse,
    RoleResponse,
    RoleUpdateRequest,
    UserPasswordChangeRequest,
    UserPreferenceResponse,
    UserPreferenceUpdateRequest,
    UserResponse,
    UserUpdateRequest,
)


class UserService:
    def __init__(self, session: AsyncSession) -> None:
        self.user_repo = UserRepository(session)
        self.role_repo = RoleRepository(session)
        self.menu_perm_repo = MenuPermissionRepository(session)

    # --- Users ---

    async def list_users(
        self,
        page: int,
        page_size: int,
        search: str | None = None,
        role_ids: list[uuid.UUID] | None = None,
        group_ids: list[uuid.UUID] | None = None,
        is_active: bool | None = None,
    ) -> tuple[list[UserResponse], int]:
        group_repo = GroupRepository(self.role_repo.session)
        group_objs = []
        if group_ids:
            for gid in group_ids:
                obj = await group_repo.get_by_id(gid)
                if obj:
                    group_objs.append(obj)

        users = await self.user_repo.get_paginated(page, page_size, search, role_ids or [], group_objs or [], is_active)
        total = await self.user_repo.count(search, role_ids or [], group_objs or [], is_active)

        user_groups_map = await group_repo.get_groups_for_users([u.id for u in users])

        result = []
        for u in users:
            resp = UserResponse.model_validate(u)
            resp.groups = [GroupBriefResponse.model_validate(g) for g in user_groups_map.get(u.id, [])]
            result.append(resp)
        return result, total

    async def get_user(self, user_id: uuid.UUID) -> UserResponse:
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise NotFoundError("User not found")
        return UserResponse.model_validate(user)

    async def update_user(
        self,
        user_id: uuid.UUID,
        data: UserUpdateRequest | AdminUserUpdateRequest,
        current_user: User,
    ) -> UserResponse:
        if not is_admin(current_user) and current_user.id != user_id:
            raise ForbiddenError()

        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise NotFoundError("User not found")

        if not is_admin(current_user) and isinstance(data, AdminUserUpdateRequest):
            data = UserUpdateRequest(**data.model_dump(include={"full_name", "avatar"}))

        update_data = data.model_dump(exclude_none=True)
        for key, value in update_data.items():
            setattr(user, key, value)

        return UserResponse.model_validate(user)

    async def get_preferences(self, user_id: uuid.UUID) -> UserPreferenceResponse:
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise NotFoundError("User not found")
        return UserPreferenceResponse.model_validate(user)

    async def update_preferences(self, user_id: uuid.UUID, data: UserPreferenceUpdateRequest) -> UserPreferenceResponse:
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise NotFoundError("User not found")
        user.locale = data.locale
        await self.user_repo.session.flush()
        return UserPreferenceResponse.model_validate(user)

    async def change_password(self, user_id: uuid.UUID, data: UserPasswordChangeRequest) -> None:
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise NotFoundError("User not found")

        if not verify_password(data.current_password, user.password):
            raise BadRequestError("Mật khẩu hiện tại không chính xác")

        user.password = hash_password(data.new_password)
        user.force_change_password = False

    async def deactivate_user(self, user_id: uuid.UUID, current_user: User) -> None:
        if not is_admin(current_user):
            raise ForbiddenError()
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise NotFoundError("User not found")
        if user.id == current_user.id:
            raise ForbiddenError("Cannot deactivate yourself")
        user.is_active = False

    async def delete_user_permanently(self, user_id: uuid.UUID, current_user: User) -> None:
        from src.models.user import User as UserModel, UserRole
        if not is_admin(current_user):
            raise ForbiddenError()
        user = await self.user_repo.get_by_id(user_id)
        if not user:
            raise NotFoundError("User not found")
        if user.id == current_user.id:
            raise ForbiddenError("Cannot delete yourself")
        if user.is_active:
            raise BadRequestError("Deactivate the user before permanently deleting")
        # UserRole rows first (DB has CASCADE but session cache still holds them)
        await self.user_repo.session.execute(
            sql_delete(UserRole).where(UserRole.user_id == user_id)
        )
        # Delete user via raw SQL to bypass ORM identity-map conflict
        await self.user_repo.session.execute(
            sql_delete(UserModel).where(UserModel.id == user_id)
        )
        await self.user_repo.session.flush()

    # --- Roles ---

    async def list_roles(self, page: int, page_size: int, search: str | None = None) -> tuple[list[RoleResponse], int]:
        roles = await self.role_repo.get_paginated(page, page_size, search)
        total = await self.role_repo.count(search)
        return [RoleResponse.model_validate(r) for r in roles], total

    async def get_role(self, role_id: uuid.UUID) -> RoleResponse:
        role = await self.role_repo.get_by_id(role_id)
        if not role:
            raise NotFoundError("Role not found")
        return RoleResponse.model_validate(role)

    async def create_role(self, data: RoleCreateRequest) -> RoleResponse:
        if await self.role_repo.get_by_name(data.name):
            raise ConflictError("Role name already exists")
        role = await self.role_repo.create(data.model_dump())
        return RoleResponse.model_validate(role)

    async def update_role(self, role_id: uuid.UUID, data: RoleUpdateRequest) -> RoleResponse:
        role = await self.role_repo.get_by_id(role_id)
        if not role:
            raise NotFoundError("Role not found")
        if role.is_default:
            raise ForbiddenError("Cannot modify the default Admin role")
        if data.name and data.name != role.name:
            if await self.role_repo.get_by_name(data.name):
                raise ConflictError("Role name already exists")
        for key, value in data.model_dump(exclude_none=True).items():
            setattr(role, key, value)
        return RoleResponse.model_validate(role)

    async def delete_role(self, role_id: uuid.UUID) -> None:
        role = await self.role_repo.get_by_id(role_id)
        if not role:
            raise NotFoundError("Role not found")
        if role.is_default:
            raise ForbiddenError("Cannot delete the default Admin role")
        await self.role_repo.delete(role_id)

    async def add_member(self, role_id: uuid.UUID, user_id: uuid.UUID, added_by: User) -> None:
        if not await self.role_repo.get_by_id(role_id):
            raise NotFoundError("Role not found")
        if not await self.user_repo.get_by_id(user_id):
            raise NotFoundError("User not found")
        if await self.role_repo.is_member(role_id, user_id):
            raise ConflictError("User is already a member")
        group_repo = GroupRepository(self.role_repo.session)
        auto_group = await group_repo.get_auto_group_by_role(role_id)
        if auto_group:
            existing_auto_role_ids = await group_repo.get_user_auto_group_role_ids(user_id)
            if any(r != role_id for r in existing_auto_role_ids):
                raise BadRequestError("User already belongs to another auto group via a different role")
        await self.role_repo.add_member(role_id, user_id, added_by.id)

    async def remove_member(self, role_id: uuid.UUID, user_id: uuid.UUID) -> None:
        if not await self.role_repo.get_by_id(role_id):
            raise NotFoundError("Role not found")
        removed = await self.role_repo.remove_member(role_id, user_id)
        if not removed:
            raise NotFoundError("User is not a member of this role")

    # --- Menu Permissions ---

    async def list_menu_permissions(self) -> list[MenuPermissionResponse]:
        items = await self.menu_perm_repo.get_all()
        return [MenuPermissionResponse.model_validate(item) for item in items]

    async def get_role_menu_permissions(self, role_id: uuid.UUID) -> list[dict]:
        if not await self.role_repo.get_by_id(role_id):
            raise NotFoundError("Role not found")
        return await self.role_repo.get_menu_permission_ids(role_id)

    async def set_role_menu_permissions(self, role_id: uuid.UUID, data: RoleMenuPermissionsUpdateRequest) -> None:
        if not await self.role_repo.get_by_id(role_id):
            raise NotFoundError("Role not found")
        items = [{"menu_permission_id": item.menu_permission_id, "level": item.level} for item in data.items]
        await self.role_repo.set_menu_permissions(role_id, items)
