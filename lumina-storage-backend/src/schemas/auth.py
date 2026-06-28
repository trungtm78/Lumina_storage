import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator, model_validator


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: str = ""


class LoginRequest(BaseModel):
    username: str  # accepts username or email
    password: str


class TokenPair(BaseModel):
    """Internal model used by AuthService — carries both tokens."""
    access_token: str
    refresh_token: str


class TokenResponse(BaseModel):
    """Public API response — refresh_token is sent via HTTP-only cookie."""
    access_token: str
    token_type: str = "bearer"
    must_change_password: bool = False


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("New password must be at least 8 characters")
        if v.isalpha() or v.isdigit():
            raise ValueError("New password must contain both letters and digits")
        return v


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    email: str
    full_name: str
    avatar: str | None
    is_active: bool
    last_login: datetime | None
    created_at: datetime
    updated_at: datetime


class MenuPermissionLevelResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    urlpath: str
    level: int  # 0=None, 1=View, 2=Edit


class RoleForMeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    is_default: bool
    permissions: list[MenuPermissionLevelResponse] = []

    @model_validator(mode="before")
    @classmethod
    def extract_menu_permissions(cls, v):
        if not hasattr(v, "menu_permissions"):
            return v
        perms = []
        for item in v.menu_permissions:
            if hasattr(item, "menu_permission") and item.menu_permission is not None:
                mp = item.menu_permission
                perms.append(MenuPermissionLevelResponse(
                    id=mp.id,
                    name=mp.name,
                    urlpath=mp.urlpath,
                    level=item.level,
                ))
        return {
            "id": v.id,
            "name": v.name,
            "is_default": v.is_default,
            "permissions": perms,
        }


class MeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    email: str
    full_name: str
    avatar: str | None
    is_active: bool
    last_login: datetime | None
    created_at: datetime
    updated_at: datetime
    role: RoleForMeResponse | None = None

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
            "last_login": data.last_login,
            "created_at": data.created_at,
            "updated_at": data.updated_at,
            "role": role,
        }
