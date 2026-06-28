import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

# Field type values currently emitted by extraction + accepted by /generate.
# `select`, `textarea`, `number` added in Phase 1 schema upgrade — user-set,
# never emitted by the heuristic extractor.
TemplateFieldType = Literal[
    "date", "blank", "placeholder", "label_empty", "empty",
    "select", "textarea", "number",
]

LanguageMode = Literal["single", "bilingual"]


class TemplateSection(BaseModel):
    key: str
    label: str
    order: int = 0


class TemplateFieldResponse(BaseModel):
    id: str
    placeholder: str
    label: str
    description: str = ""
    location: str
    type: str
    options: list[str] | None = None
    section_key: str | None = None
    required: bool | None = None


class TemplateResponse(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    original_filename: str
    source_document_id: uuid.UUID | None
    template_fields: list[TemplateFieldResponse] = []
    extraction_status: str | None = None
    extraction_error: str | None = None
    field_count: int = 0
    language_mode: LanguageMode = "single"
    sections: list[TemplateSection] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TemplateUpdateRequest(BaseModel):
    description: str | None = None
    language_mode: LanguageMode | None = None
    sections: list[TemplateSection] | None = None


class TemplateFieldUpdateRequest(BaseModel):
    id: str
    placeholder: str
    label: str
    description: str | None = None
    type: str | None = None
    options: list[str] | None = None
    section_key: str | None = None
    required: bool | None = None


class TemplateFieldsUpdateRequest(BaseModel):
    fields: list[TemplateFieldUpdateRequest]


class PaginatedTemplatesResponse(BaseModel):
    items: list[TemplateResponse]
    has_more: bool
