import uuid

from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.user import Role, RoleMenuPermission, UserRole
from src.repositories.base import BaseRepository


class RoleRepository(BaseRepository[Role]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Role, session)

    async def get_by_name(self, name: str) -> Role | None:
        result = await self.session.execute(select(Role).where(Role.name == name))
        return result.scalar_one_or_none()

    async def count(self, search: str | None = None) -> int:
        q = select(func.count()).select_from(Role)
        if search:
            q = q.where(Role.name.ilike(f"%{search}%"))
        result = await self.session.execute(q)
        return result.scalar_one()

    async def get_paginated(self, page: int, page_size: int, search: str | None = None) -> list[Role]:
        q = select(Role)
        if search:
            q = q.where(Role.name.ilike(f"%{search}%"))
        result = await self.session.execute(
            q.order_by(Role.name).offset((page - 1) * page_size).limit(page_size)
        )
        return list(result.scalars().all())

    async def add_member(self, role_id: uuid.UUID, user_id: uuid.UUID, added_by_id: uuid.UUID) -> UserRole:
        membership = UserRole(user_id=user_id, role_id=role_id, added_by_id=added_by_id)
        self.session.add(membership)
        await self.session.flush()
        return membership

    async def remove_member(self, role_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        result = await self.session.execute(
            select(UserRole).where(UserRole.role_id == role_id, UserRole.user_id == user_id)
        )
        membership = result.scalar_one_or_none()
        if membership is None:
            return False
        await self.session.delete(membership)
        await self.session.flush()
        return True

    async def is_member(self, role_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        result = await self.session.execute(
            select(UserRole).where(UserRole.role_id == role_id, UserRole.user_id == user_id)
        )
        return result.scalar_one_or_none() is not None

    async def get_menu_permission_ids(self, role_id: uuid.UUID) -> list[dict]:
        """Return list of {menu_permission_id, level} for a role."""
        result = await self.session.execute(
            select(RoleMenuPermission)
            .where(RoleMenuPermission.role_id == role_id)
        )
        items = result.scalars().all()
        return [{"menu_permission_id": item.menu_permission_id, "level": item.level} for item in items]

    async def set_menu_permissions(self, role_id: uuid.UUID, items: list[dict]) -> None:
        """Replace all menu permissions for a role. items = [{menu_permission_id, level}]"""
        await self.session.execute(
            sa_delete(RoleMenuPermission).where(RoleMenuPermission.role_id == role_id)
        )
        for item in items:
            if item["level"] > 0:  # only store non-zero levels
                self.session.add(RoleMenuPermission(
                    role_id=role_id,
                    menu_permission_id=item["menu_permission_id"],
                    level=item["level"],
                ))
        await self.session.flush()
