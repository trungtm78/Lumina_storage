from pydantic import BaseModel


class StorageBreakdown(BaseModel):
    documents_bytes: int
    spreadsheets_bytes: int
    presentations_bytes: int
    other_bytes: int


class StorageStats(BaseModel):
    used_bytes: int
    max_gb: int
    breakdown: StorageBreakdown


class ProcessingStats(BaseModel):
    total: int
    processing: int
    completed: int
    failed: int
    queued: int


class SharedStats(BaseModel):
    total: int
    shared_by_me: int
    shared_with_me: int


class DocumentCountStats(BaseModel):
    total: int
    added_today: int
    added_this_week: int
    added_this_month: int


class ActivityStats(BaseModel):
    total_today: int
    uploaded_today: int
    viewed_today: int
    shared_today: int


class DashboardStatsResponse(BaseModel):
    storage: StorageStats
    processing: ProcessingStats
    shared: SharedStats
    documents: DocumentCountStats
    activity: ActivityStats


class ProcessingFileItem(BaseModel):
    id: str
    document_id: str | None
    file_name: str
    extension: str
    status: str
    created_at: str


class RecentFileItem(BaseModel):
    id: str
    title: str
    extension: str
    owner_name: str | None
    updated_at: str


class SharedFileItem(BaseModel):
    id: str
    title: str
    extension: str
    owner_name: str | None
    updated_at: str
