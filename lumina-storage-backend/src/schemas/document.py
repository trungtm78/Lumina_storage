import uuid
from datetime import datetime

from pydantic import BaseModel, model_validator


class ProcessStatusResponse(BaseModel):
    id: uuid.UUID
    task_name: str
    status: str
    result: dict | None = None
    error_message: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
from pydantic import BaseModel, ConfigDict


# --- StorageConfig ---

class StorageConnectionTestRequest(BaseModel):
    backend_type: str
    config: dict

class StorageConfigCreateRequest(BaseModel):
    name: str
    backend_type: str
    config: dict = {}
    is_default: bool = False

class StorageConfigUpdateRequest(BaseModel):
    name: str | None = None
    backend_type: str | None = None
    config: dict | None = None
    is_active: bool | None = None

class UserStorageConfigCreateRequest(BaseModel):
    name: str
    backend_type: str
    config: dict = {}

class StorageConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    backend_type: str
    config: dict
    is_default: bool
    is_active: bool
    owner_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


# --- Folder ---

class FolderCreateRequest(BaseModel):
    name: str
    parent_id: uuid.UUID | None = None

class FolderUpdateRequest(BaseModel):
    name: str

class FolderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    parent_id: uuid.UUID | None
    path: str
    owner_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


# --- Document ---

class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None
    file_name: str
    original_filename: str
    file_path: str
    file_size: int
    mime_type: str
    extension: str
    checksum: str
    folder_id: uuid.UUID | None
    storage_config_id: uuid.UUID
    owner_id: uuid.UUID | None
    uploader_name: str | None = None
    source_type: str
    source_metadata: dict | None
    starred: bool
    page_count: int | None
    image_thumbnail: str | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


# --- Document Permission ---

class DocumentPermissionCreateRequest(BaseModel):
    group_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    permission: str  # viewer / editor / manager

    @model_validator(mode="after")
    def check_grantee(self) -> "DocumentPermissionCreateRequest":
        if (self.group_id is None) == (self.user_id is None):
            raise ValueError("Exactly one of group_id or user_id must be provided")
        return self


class DocumentPermissionUpdateRequest(BaseModel):
    permission: str  # viewer / editor / manager


class DocumentPermissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID | None
    folder_id: uuid.UUID | None
    group_id: uuid.UUID | None = None
    group_name: str | None = None
    user_id: uuid.UUID | None = None
    user_name: str | None = None
    user_email: str | None = None
    permission: str
    created_at: datetime
    created_by_id: uuid.UUID


class BulkDeleteRequest(BaseModel):
    document_ids: list[uuid.UUID]


class MoveToFolderRequest(BaseModel):
    folder_id: uuid.UUID | None


class DocumentUpdateRequest(BaseModel):
    title: str | None = None

class DocumentUploadResponse(BaseModel):
    documents: list[DocumentResponse]
    folder: FolderResponse | None = None


# --- Google Drive ---

class GoogleDriveImportRequest(BaseModel):
    url: str
    folder_id: uuid.UUID | None = None
    is_template: bool = False

class GoogleDriveImportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    drive_file_id: str
    drive_file_name: str
    drive_url: str
    mime_type: str
    status: str
    document_id: uuid.UUID | None
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None
