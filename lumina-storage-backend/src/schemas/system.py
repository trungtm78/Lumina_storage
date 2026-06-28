import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class SystemConfigCreateRequest(BaseModel):
    key: str
    value: Any
    description: str | None = None
    is_public: bool = False


class SystemConfigUpdateRequest(BaseModel):
    value: Any | None = None
    description: str | None = None
    is_public: bool | None = None


class SystemConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    value: Any
    description: str | None
    is_public: bool
    updated_at: datetime
    updated_by_id: uuid.UUID | None


class PublicConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    value: Any
