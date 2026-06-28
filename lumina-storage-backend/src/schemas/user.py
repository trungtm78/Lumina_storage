import uuid
from datetime import datetime

from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, model_validator


class UserPreferenceUpdateRequest(BaseModel):
    locale: Literal["vi", "en"]


class UserPreferenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    locale: str


class UserUpdateRequest(BaseModel):
    """Fields any user can update on their own profile."""
    full_name: str | None = None
    avatar: str | None = None


class UserPasswordChangeRequest(BaseModel):
    """Payload for user to change their own password."""
    current_password: str
    new_password: str


class AdminUserUpdateRequest(UserUpdateRequest):
    """Additional fields only admin can change."""
    email: EmailStr | None = None
    is_active: bool | None = None


class RoleCreateRequest(BaseModel):
    name: str
    description: str | None = None


class RoleUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class RoleMemberRequest(BaseModel):
    user_id: uuid.UUID


# --- Responses ---

class RoleBriefResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str


class GroupBriefResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    type: str  # "manual" | "auto"


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    email: str
    full_name: str
    avatar: str | None
    is_active: bool
    locale: str
    last_login: datetime | None
    created_at: datetime
    updated_at: datetime
    role: RoleBriefResponse | None = None
    groups: list[GroupBriefResponse] = []

    @model_validator(mode="before")
    @classmethod
    def extract_role_from_roles(cls, data):
        if not hasattr(data, "roles"):
            return data
        user_roles = data.roles
        role = None
        if user_roles:
            item = user_roles[0]
            role = item.role if hasattr(item, "role") else item
        return {
            "id": data.id,
            "username": data.username,
            "email": data.email,
            "full_name": data.full_name,
            "avatar": data.avatar,
            "is_active": data.is_active,
            "locale": data.locale,
            "last_login": data.last_login,
            "created_at": data.created_at,
            "updated_at": data.updated_at,
            "role": role,
            "groups": getattr(data, "groups", []),
        }


class RoleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    is_default: bool
    created_at: datetime
    updated_at: datetime


class MenuPermissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    urlpath: str
    order_index: int


class RoleMenuPermissionItem(BaseModel):
    menu_permission_id: int
    level: int  # 0=None, 1=View, 2=Edit


class RoleMenuPermissionsUpdateRequest(BaseModel):
    items: list[RoleMenuPermissionItem]


class RoleMenuPermissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    menu_permission_id: int
    level: int
    menu_permission: MenuPermissionResponse


class PaginatedResponse(BaseModel):
    items: list
    total: int
    page: int
    page_size: int
