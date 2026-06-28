import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, model_validator


class GroupCreateRequest(BaseModel):
    name: str
    description: str | None = None
    type: str  # "manual" | "auto"
    is_select_all: bool = False           # manual: include all users (minus excludes)
    user_ids: list[uuid.UUID] = []        # manual: explicit members (ignored if is_select_all)
    exclude_ids: list[uuid.UUID] = []     # manual: exclude list
    filter_role_id: uuid.UUID | None = None  # auto: role to filter by


class GroupUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    is_select_all: bool | None = None
    user_ids: list[uuid.UUID] | None = None
    exclude_ids: list[uuid.UUID] | None = None
    filter_role_id: uuid.UUID | None = None


class GroupMemberRequest(BaseModel):
    user_id: uuid.UUID


class UserBriefResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    full_name: str
    email: str
    is_active: bool


class RoleBriefForMember(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str


class GroupMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    full_name: str
    email: str
    is_active: bool
    role: RoleBriefForMember | None = None

    @model_validator(mode="before")
    @classmethod
    def extract_role(cls, data):
        if not hasattr(data, "roles"):
            return data
        user_roles = getattr(data, "roles", [])
        role = None
        if user_roles:
            first = user_roles[0]
            role = getattr(first, "role", None)
        return {
            "id": data.id,
            "username": data.username,
            "full_name": data.full_name,
            "email": data.email,
            "is_active": data.is_active,
            "role": role,
        }


class GroupResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None = None
    type: str
    is_select_all: bool = False
    filter_role_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    member_count: int = 0


class GroupDetailResponse(GroupResponse):
    members: list[UserBriefResponse] = []
