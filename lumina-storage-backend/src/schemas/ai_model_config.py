import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator

VALID_PURPOSES = {"chat", "embedding"}
VALID_PROVIDERS = {"azure", "openai", "anthropic", "google", "ollama"}


class AIModelConfigResponse(BaseModel):
    id: uuid.UUID
    name: str
    provider: str
    model_name: str
    purpose: str
    base_url: str | None
    extra_config: dict | None
    is_default: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AIModelConfigCreateRequest(BaseModel):
    name: str
    provider: str
    model_name: str
    purpose: str
    api_key: str | None = None
    base_url: str | None = None
    extra_config: dict | None = None
    is_default: bool = False

    @field_validator("purpose")
    @classmethod
    def validate_purpose(cls, v: str) -> str:
        if v not in VALID_PURPOSES:
            raise ValueError(f"purpose must be one of {VALID_PURPOSES}")
        return v

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, v: str) -> str:
        if v not in VALID_PROVIDERS:
            raise ValueError(f"provider must be one of {VALID_PROVIDERS}")
        return v


class AIModelConfigUpdateRequest(BaseModel):
    name: str | None = None
    provider: str | None = None
    model_name: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    extra_config: dict | None = None
    is_active: bool | None = None


class AIModelConfigTestRequest(BaseModel):
    model_name: str
    provider: str
    purpose: str = "chat"  # "chat" | "embedding"
    api_key: str | None = None
    base_url: str | None = None
    extra_config: dict | None = None
    config_id: uuid.UUID | None = None  # If set and api_key is None, load key from DB


class AIModelConfigTestResponse(BaseModel):
    success: bool
    message: str
    response_preview: str | None = None
