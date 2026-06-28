import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import BadRequestError, NotFoundError
from src.models.user import User
from src.repositories.group import GroupRepository
from src.repositories.role import RoleRepository
from src.repositories.user import UserRepository
from src.schemas.group import GroupCreateRequest, GroupDetailResponse, GroupMemberResponse, GroupResponse, GroupUpdateRequest, UserBriefResponse


class GroupService:
    def __init__(self, session: AsyncSession) -> None:
        self.group_repo = GroupRepository(session)
        self.role_repo = RoleRepository(session)
        self.user_repo = UserRepository(session)

    async def list_groups(self, page: int, page_size: int, search: str | None = None, type: str | None = None) -> tuple[list[GroupResponse], int]:
        groups = await self.group_repo.get_paginated(page, page_size, search, type)
        total = await self.group_repo.count(search, type)
        result = []
        for g in groups:
            member_count = await self.group_repo.get_member_count(g.id)
            resp = GroupResponse.model_validate(g)
            resp.member_count = member_count
            result.append(resp)
        return result, total

    async def get_group(self, group_id: uuid.UUID) -> GroupDetailResponse:
        group = await self.group_repo.get_by_id(group_id)
        if not group:
            raise NotFoundError("Group not found")
        members = await self.group_repo.get_members(group_id)
        base = GroupResponse.model_validate(group)
        return GroupDetailResponse(
            **base.model_dump(exclude={"member_count"}),
            member_count=len(members),
            members=[UserBriefResponse.model_validate(m) for m in members],
        )

    async def create_group(self, data: GroupCreateRequest, current_user: User) -> GroupDetailResponse:
        if data.type not in ("manual", "auto"):
            raise BadRequestError("type must be 'manual' or 'auto'")
        if data.type == "auto" and not data.filter_role_id:
            raise BadRequestError("filter_role_id is required for auto groups")
        if data.type == "auto" and data.filter_role_id:
            if not await self.role_repo.get_by_id(data.filter_role_id):
                raise NotFoundError("Role not found")

        group = await self.group_repo.create(
            name=data.name,
            description=data.description,
            type=data.type,
            is_select_all=data.is_select_all if data.type == "manual" else False,
            created_by_id=current_user.id,
            filter_role_id=data.filter_role_id,
            user_ids=data.user_ids if data.type == "manual" else None,
            exclude_ids=data.exclude_ids if data.type == "manual" else None,
        )
        return await self.get_group(group.id)

    async def update_group(self, group_id: uuid.UUID, data: GroupUpdateRequest) -> GroupDetailResponse:
        group = await self.group_repo.get_by_id(group_id)
        if not group:
            raise NotFoundError("Group not found")
        if data.filter_role_id and not await self.role_repo.get_by_id(data.filter_role_id):
            raise NotFoundError("Role not found")

        await self.group_repo.update(
            group_id=group_id,
            name=data.name,
            description=data.description,
            is_select_all=data.is_select_all,
            filter_role_id=data.filter_role_id,
            user_ids=data.user_ids,
            exclude_ids=data.exclude_ids,
        )
        return await self.get_group(group_id)

    async def delete_group(self, group_id: uuid.UUID) -> None:
        group = await self.group_repo.get_by_id(group_id)
        if not group:
            raise NotFoundError("Group not found")
        await self.group_repo.delete(group_id)

    async def add_member(self, group_id: uuid.UUID, user_id: uuid.UUID) -> None:
        group = await self.group_repo.get_by_id(group_id)
        if not group:
            raise NotFoundError("Group not found")
        if group.type != "manual":
            raise BadRequestError("Cannot manually add members to an auto group")
        await self.group_repo.add_member(group_id, user_id)

    async def remove_member(self, group_id: uuid.UUID, user_id: uuid.UUID) -> None:
        group = await self.group_repo.get_by_id(group_id)
        if not group:
            raise NotFoundError("Group not found")
        if group.type != "manual":
            raise BadRequestError("Cannot manually remove members from an auto group")
        await self.group_repo.remove_member(group_id, user_id)

    async def get_members(self, group_id: uuid.UUID) -> list[UserBriefResponse]:
        group = await self.group_repo.get_by_id(group_id)
        if not group:
            raise NotFoundError("Group not found")
        members = await self.group_repo.get_members(group_id)
        return [UserBriefResponse.model_validate(m) for m in members]

    async def list_members(
        self,
        group_id: uuid.UUID,
        page: int,
        page_size: int,
        search: str | None = None,
    ) -> tuple[list[GroupMemberResponse], int]:
        group = await self.group_repo.get_by_id(group_id)
        if not group:
            raise NotFoundError("Group not found")
        members = await self.group_repo.get_members_paginated(group_id, page, page_size, search)
        total = await self.group_repo.count_members_filtered(group_id, search)
        return [GroupMemberResponse.model_validate(m) for m in members], total
