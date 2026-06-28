import uuid

from sqlalchemy import delete as sa_delete, exists, func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.group import Group, GroupExclude, GroupMember
from src.models.user import User, UserRole


class GroupRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        name: str,
        type: str,
        created_by_id: uuid.UUID,
        description: str | None = None,
        is_select_all: bool = False,
        filter_role_id: uuid.UUID | None = None,
        user_ids: list[uuid.UUID] | None = None,
        exclude_ids: list[uuid.UUID] | None = None,
    ) -> Group:
        group = Group(
            name=name,
            description=description,
            type=type,
            is_select_all=is_select_all,
            filter_role_id=filter_role_id,
            created_by_id=created_by_id,
        )
        self.session.add(group)
        await self.session.flush()

        if type == "manual":
            if not is_select_all:
                for uid in (user_ids or []):
                    self.session.add(GroupMember(group_id=group.id, user_id=uid))
            for uid in (exclude_ids or []):
                self.session.add(GroupExclude(group_id=group.id, user_id=uid))
            await self.session.flush()

        return group

    async def get_by_id(self, group_id: uuid.UUID) -> Group | None:
        result = await self.session.execute(
            select(Group).where(Group.id == group_id)
        )
        return result.scalar_one_or_none()

    async def count(self, search: str | None = None, type: str | None = None) -> int:
        q = select(func.count()).select_from(Group)
        if search:
            q = q.where(Group.name.ilike(f"%{search}%"))
        if type:
            q = q.where(Group.type == type)
        result = await self.session.execute(q)
        return result.scalar_one()

    async def get_paginated(self, page: int, page_size: int, search: str | None = None, type: str | None = None) -> list[Group]:
        q = select(Group)
        if search:
            q = q.where(Group.name.ilike(f"%{search}%"))
        if type:
            q = q.where(Group.type == type)
        result = await self.session.execute(
            q.order_by(Group.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(result.scalars().all())

    async def update(
        self,
        group_id: uuid.UUID,
        name: str | None = None,
        description: str | None = None,
        is_select_all: bool | None = None,
        filter_role_id: uuid.UUID | None = None,
        user_ids: list[uuid.UUID] | None = None,
        exclude_ids: list[uuid.UUID] | None = None,
    ) -> Group | None:
        group = await self.get_by_id(group_id)
        if not group:
            return None
        if name is not None:
            group.name = name
        if description is not None:
            group.description = description
        if is_select_all is not None:
            group.is_select_all = is_select_all
        if filter_role_id is not None:
            group.filter_role_id = filter_role_id

        if group.type == "manual":
            effective_select_all = is_select_all if is_select_all is not None else group.is_select_all
            if effective_select_all:
                # Clear explicit members — not needed when selecting all
                await self.session.execute(sa_delete(GroupMember).where(GroupMember.group_id == group_id))
            elif user_ids is not None:
                await self.session.execute(sa_delete(GroupMember).where(GroupMember.group_id == group_id))
                for uid in user_ids:
                    self.session.add(GroupMember(group_id=group_id, user_id=uid))
            if exclude_ids is not None:
                await self.session.execute(sa_delete(GroupExclude).where(GroupExclude.group_id == group_id))
                for uid in exclude_ids:
                    self.session.add(GroupExclude(group_id=group_id, user_id=uid))

        await self.session.flush()
        return group

    async def delete(self, group_id: uuid.UUID) -> bool:
        group = await self.get_by_id(group_id)
        if not group:
            return False
        await self.session.delete(group)
        await self.session.flush()
        return True

    async def get_members(self, group_id: uuid.UUID) -> list[User]:
        group = await self.get_by_id(group_id)
        if not group:
            return []

        if group.type == "manual":
            excluded_subq = (
                select(GroupExclude.user_id)
                .where(GroupExclude.group_id == group_id)
                .correlate(None)
            )
            if group.is_select_all:
                # All users except excluded
                result = await self.session.execute(
                    select(User)
                    .where(User.id.not_in(excluded_subq))
                    .order_by(User.username)
                )
            else:
                # Explicit members minus excluded
                result = await self.session.execute(
                    select(User)
                    .join(GroupMember, GroupMember.user_id == User.id)
                    .where(
                        GroupMember.group_id == group_id,
                        User.id.not_in(excluded_subq),
                    )
                    .order_by(User.username)
                )
            return list(result.scalars().all())
        else:
            # auto: all users with the filter role
            if not group.filter_role_id:
                return []
            result = await self.session.execute(
                select(User)
                .join(UserRole, UserRole.user_id == User.id)
                .where(UserRole.role_id == group.filter_role_id)
                .order_by(User.username)
            )
            return list(result.scalars().all())

    async def add_member(self, group_id: uuid.UUID, user_id: uuid.UUID) -> None:
        existing = await self.session.execute(
            select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
        )
        if not existing.scalar_one_or_none():
            self.session.add(GroupMember(group_id=group_id, user_id=user_id))
            await self.session.flush()

    async def remove_member(self, group_id: uuid.UUID, user_id: uuid.UUID) -> None:
        await self.session.execute(
            sa_delete(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
        )
        await self.session.flush()

    async def get_member_count(self, group_id: uuid.UUID) -> int:
        group = await self.get_by_id(group_id)
        if not group:
            return 0
        if group.type == "manual" and group.is_select_all:
            excluded_subq = select(GroupExclude.user_id).where(GroupExclude.group_id == group_id)
            result = await self.session.execute(
                select(func.count()).select_from(User).where(User.id.not_in(excluded_subq))
            )
            return result.scalar_one()
        members = await self.get_members(group_id)
        return len(members)

    def _build_members_base_query(self, group: Group, search: str | None):
        """Build a SELECT(User) query for the group, with optional search filter."""
        search_filter = (
            or_(User.full_name.ilike(f"%{search}%"), User.email.ilike(f"%{search}%"))
            if search
            else true()
        )
        excluded_subq = (
            select(GroupExclude.user_id)
            .where(GroupExclude.group_id == group.id)
            .correlate(None)
        )
        if group.type == "manual":
            if group.is_select_all:
                return select(User).where(User.id.not_in(excluded_subq), search_filter)
            else:
                return (
                    select(User)
                    .join(GroupMember, GroupMember.user_id == User.id)
                    .where(
                        GroupMember.group_id == group.id,
                        User.id.not_in(excluded_subq),
                        search_filter,
                    )
                )
        else:  # auto
            if not group.filter_role_id:
                return None
            return (
                select(User)
                .join(UserRole, UserRole.user_id == User.id)
                .where(UserRole.role_id == group.filter_role_id, search_filter)
                .distinct()
            )

    async def get_members_paginated(
        self,
        group_id: uuid.UUID,
        page: int,
        page_size: int,
        search: str | None = None,
    ) -> list[User]:
        group = await self.get_by_id(group_id)
        if not group:
            return []
        q = self._build_members_base_query(group, search)
        if q is None:
            return []
        q = (
            q.options(selectinload(User.roles).selectinload(UserRole.role))
            .order_by(User.username)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await self.session.execute(q)
        return list(result.scalars().unique().all())

    async def count_members_filtered(
        self,
        group_id: uuid.UUID,
        search: str | None = None,
    ) -> int:
        group = await self.get_by_id(group_id)
        if not group:
            return 0
        q = self._build_members_base_query(group, search)
        if q is None:
            return 0
        count_q = select(func.count()).select_from(q.subquery())
        result = await self.session.execute(count_q)
        return result.scalar_one()

    async def get_groups_for_users(self, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[dict]]:
        """Batch fetch groups (manual + auto) for a list of users. Returns {user_id: [{id, name, type}]}."""
        result_map: dict[uuid.UUID, list[dict]] = {uid: [] for uid in user_ids}
        if not user_ids:
            return result_map

        # Manual (is_select_all=True): all users in the list unless excluded
        rows = await self.session.execute(
            select(Group.id, Group.name, Group.type)
            .where(Group.type == "manual", Group.is_select_all.is_(True))
        )
        select_all_groups = rows.all()
        for g_id, g_name, g_type in select_all_groups:
            excluded_ids_result = await self.session.execute(
                select(GroupExclude.user_id).where(GroupExclude.group_id == g_id)
            )
            excluded = set(excluded_ids_result.scalars().all())
            for uid in user_ids:
                if uid not in excluded:
                    result_map[uid].append({"id": g_id, "name": g_name, "type": g_type})

        # Manual (explicit members): explicit members minus excludes
        rows = await self.session.execute(
            select(GroupMember.user_id, Group.id, Group.name, Group.type)
            .join(Group, Group.id == GroupMember.group_id)
            .where(
                GroupMember.user_id.in_(user_ids),
                Group.is_select_all.is_(False),
                ~exists(
                    select(GroupExclude.group_id).where(
                        GroupExclude.group_id == GroupMember.group_id,
                        GroupExclude.user_id == GroupMember.user_id,
                    )
                ),
            )
        )
        for uid, g_id, g_name, g_type in rows:
            result_map[uid].append({"id": g_id, "name": g_name, "type": g_type})

        # Auto: users whose role matches filter_role_id
        rows = await self.session.execute(
            select(UserRole.user_id, Group.id, Group.name, Group.type)
            .join(Group, Group.filter_role_id == UserRole.role_id)
            .where(UserRole.user_id.in_(user_ids), Group.type == "auto")
        )
        for uid, g_id, g_name, g_type in rows:
            result_map[uid].append({"id": g_id, "name": g_name, "type": g_type})

        return result_map

    async def get_auto_group_by_role(self, role_id: uuid.UUID) -> Group | None:
        result = await self.session.execute(
            select(Group).where(Group.type == "auto", Group.filter_role_id == role_id)
        )
        return result.scalar_one_or_none()

    async def get_user_auto_group_role_ids(self, user_id: uuid.UUID) -> list[uuid.UUID]:
        """Returns role_ids the user has that each have an associated auto group."""
        result = await self.session.execute(
            select(UserRole.role_id)
            .join(Group, Group.filter_role_id == UserRole.role_id)
            .where(UserRole.user_id == user_id, Group.type == "auto")
        )
        return list(result.scalars().all())

    async def get_user_group_ids(self, user_id: uuid.UUID, role_ids: list[uuid.UUID]) -> list[uuid.UUID]:
        """Return all group IDs the user belongs to (manual + auto)."""
        group_ids: list[uuid.UUID] = []

        # Manual groups: user is in GroupMember and NOT in GroupExclude
        excluded_subq = (
            select(GroupExclude.group_id)
            .where(GroupExclude.user_id == user_id)
            .correlate(None)
        )
        result = await self.session.execute(
            select(GroupMember.group_id)
            .where(
                GroupMember.user_id == user_id,
                GroupMember.group_id.not_in(excluded_subq),
            )
        )
        group_ids.extend(result.scalars().all())

        # Auto groups: filter_role_id is one of user's roles
        if role_ids:
            result = await self.session.execute(
                select(Group.id)
                .where(
                    Group.type == "auto",
                    Group.filter_role_id.in_(role_ids),
                )
            )
            group_ids.extend(result.scalars().all())

        return list(set(group_ids))
