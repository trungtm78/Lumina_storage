"""Phase 5b — schema ExtractionProviderConfig (mirror AIModelConfig). Response OMIT api_key."""
import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator

VALID_PROVIDERS = {"local_hybrid", "gemini", "mistral", "azure_di", "landing_ai"}


class ExtractionProviderConfigResponse(BaseModel):
    id: uuid.UUID
    name: str
    provider: str
    base_url: str | None
    options: dict | None
    applies_to: list | None
    priority: int
    is_default: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
    # api_key CỐ Ý OMIT — không bao giờ trả về client.


class ExtractionProviderConfigCreateRequest(BaseModel):
    name: str
    provider: str
    api_key: str | None = None
    base_url: str | None = None
    options: dict | None = None
    applies_to: list | None = None
    priority: int = 100
    is_default: bool = False

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, v: str) -> str:
        if v not in VALID_PROVIDERS:
            raise ValueError(f"provider must be one of {VALID_PROVIDERS}")
        return v


class ExtractionProviderConfigUpdateRequest(BaseModel):
    name: str | None = None
    provider: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    options: dict | None = None
    applies_to: list | None = None
    priority: int | None = None
    is_active: bool | None = None

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, v: str | None) -> str | None:
        # codex P2: chặn PATCH provider không hỗ trợ → tránh row không dựng được ở selector.
        if v is not None and v not in VALID_PROVIDERS:
            raise ValueError(f"provider must be one of {VALID_PROVIDERS}")
        return v


class ExtractionProviderConfigTestRequest(BaseModel):
    provider: str
    api_key: str | None = None
    base_url: str | None = None
    options: dict | None = None
    config_id: uuid.UUID | None = None  # nếu set + api_key None → load key từ DB


class ExtractionProviderConfigTestResponse(BaseModel):
    success: bool
    message: str
