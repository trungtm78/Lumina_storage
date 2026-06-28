import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    title: str | None = None


class SessionResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MessageSourceResponse(BaseModel):
    citation_index: int
    document_id: uuid.UUID
    document_title: str
    original_filename: str
    page_number: int | None
    relevance_score: float | None
    excerpt: str | None


class MessageResponse(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    role: str
    content: str
    model_used: str | None
    created_at: datetime
    sources: list[MessageSourceResponse] = []
    skill_result: dict | None = None
    attachments: list[dict] | None = None

    model_config = {"from_attributes": True}


class SendMessageRequest(BaseModel):
    content: str
    # Cap số document đính kèm để giới hạn N permission-check mỗi request.
    document_ids: list[uuid.UUID] | None = Field(default=None, max_length=50)
    model_id: uuid.UUID | None = None


class UpdateSessionRequest(BaseModel):
    title: str | None = None


class PaginatedSessionsResponse(BaseModel):
    items: list[SessionResponse]
    has_more: bool


class PaginatedMessagesResponse(BaseModel):
    items: list[MessageResponse]
    has_more: bool
