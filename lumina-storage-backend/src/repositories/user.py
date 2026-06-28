import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.user import MenuPermission, Role, RoleMenuPermission, User, UserRole
from src.repositories.base import BaseRepository

if TYPE_CHECKING:
    from src.models.group import Group


class UserRepository(BaseRepository[User]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(User, session)

    def _user_filter_conditions(
        self,
        search: str | None = None,
        role_ids: list[uuid.UUID] | None = None,
        group_objs: "list[Group] | None" = None,
        is_active: bool | None = None,
    ) -> list[Any]:
        """Build WHERE conditions for user search/filter queries."""
        from sqlalchemy import or_ as sa_or
        from src.models.group import GroupExclude, GroupMember

        conditions: list[Any] = []

        if search:
            conditions.append(or_(
                User.full_name.ilike(f"%{search}%"),
                User.email.ilike(f"%{search}%"),
                User.username.ilike(f"%{search}%"),
            ))

        if is_active is not None:
            conditions.append(User.is_active == is_active)

        if role_ids:
            role_subq = select(UserRole.user_id).where(UserRole.role_id.in_(role_ids))
            conditions.append(User.id.in_(role_subq))

        if group_objs:
            group_clauses = []
            for group_obj in group_objs:
                if group_obj.type == "manual":
                    exclude_subq = select(GroupExclude.user_id).where(GroupExclude.group_id == group_obj.id)
                    if group_obj.is_select_all:
                        group_clauses.append(User.id.not_in(exclude_subq))
                    else:
                        member_subq = select(GroupMember.user_id).where(
                            GroupMember.group_id == group_obj.id,
                            GroupMember.user_id.not_in(exclude_subq),
                        )
                        group_clauses.append(User.id.in_(member_subq))
                elif group_obj.filter_role_id:  # auto
                    auto_subq = select(UserRole.user_id).where(UserRole.role_id == group_obj.filter_role_id)
                    group_clauses.append(User.id.in_(auto_subq))
            if group_clauses:
                conditions.append(sa_or(*group_clauses))

        return conditions

    async def count(
        self,
        search: str | None = None,
        role_ids: list[uuid.UUID] | None = None,
        group_objs: "list[Group] | None" = None,
        is_active: bool | None = None,
    ) -> int:
        conditions = self._user_filter_conditions(search, role_ids, group_objs, is_active)
        query = select(func.count()).select_from(User)
        if conditions:
            query = query.where(*conditions)
        result = await self.session.execute(query)
        return result.scalar_one()

    async def get_by_id(self, id: uuid.UUID) -> User | None:
        result = await self.session.execute(
            select(User)
            .options(selectinload(User.roles).selectinload(UserRole.role))
            .where(User.id == id)
        )
        return result.scalar_one_or_none()

    async def get_paginated(
        self,
        page: int,
        page_size: int,
        search: str | None = None,
        role_ids: list[uuid.UUID] | None = None,
        group_objs: "list[Group] | None" = None,
        is_active: bool | None = None,
    ) -> list[User]:
        conditions = self._user_filter_conditions(search, role_ids, group_objs, is_active)
        query = (
            select(User)
            .options(selectinload(User.roles).selectinload(UserRole.role))
            .order_by(User.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        if conditions:
            query = query.where(*conditions)
        result = await self.session.execute(query)
        return list(result.scalars().all())

    async def get_by_id_with_permissions(self, id: uuid.UUID) -> User | None:
        """Load user with roles + each role's menu permissions (for /auth/me)."""
        result = await self.session.execute(
            select(User)
            .options(
                selectinload(User.roles)
                .selectinload(UserRole.role)
                .selectinload(Role.menu_permissions)
                .selectinload(RoleMenuPermission.menu_permission)
            )
            .where(User.id == id)
        )
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> User | None:
        result = await self.session.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_by_username(self, username: str) -> User | None:
        result = await self.session.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()

    async def get_by_username_or_email(self, identifier: str) -> User | None:
        result = await self.session.execute(
            select(User).where(or_(User.username == identifier, User.email == identifier))
        )
        return result.scalar_one_or_none()

    async def get_or_provision_by_entra(
        self,
        email: str,
        full_name: str = "",
    ) -> User:
        """Find or create a local User for a Microsoft Entra identity (OBO path).

        Mirrors the SSO auto-provisioning in deps._validate_sso_session:
        - Reuses the existing user if found by email.
        - Auto-creates with a disabled-login password if not found.
        - Assigns the first role named "viewer" (case-insensitive) if present;
          otherwise leaves the user without a role (same as SSO provisioning).
        Raises PermissionError if the existing account is inactive.
        """
        import secrets as _secrets

        user = await self.get_by_email(email)
        if user:
            if not user.is_active:
                raise PermissionError(f"Account {email!r} is inactive")
            return await self.get_by_id(user.id)

        # Derive a unique username from the email local-part
        base = email.split("@")[0]
        username = base
        i = 2
        while await self.get_by_username(username):
            username = f"{base}{i}"
            i += 1

        user = await self.create({
            "username": username,
            "email": email,
            "full_name": full_name or email,
            "password": f"!{_secrets.token_hex(16)}",
        })

        # Attempt to assign a viewer-like role; skip silently if none exists
        viewer_result = await self.session.execute(
            select(Role).where(func.lower(Role.name) == "viewer")
        )
        viewer_role = viewer_result.scalar_one_or_none()
        if viewer_role is not None:
            self.session.add(UserRole(user_id=user.id, role_id=viewer_role.id))
            await self.session.flush()

        return await self.get_by_id(user.id)
