import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from src.schemas.template import TemplateFieldResponse


class GeneratorSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    doc_type: str | None
    title: str | None
    field_values: dict
    template_id: uuid.UUID | None
    document_id: uuid.UUID | None
    folder_id: uuid.UUID | None
    error_message: str | None
    edited_html: str | None = None
    created_at: datetime
    updated_at: datetime
    template_exists: bool = True


class GeneratorSessionListResponse(BaseModel):
    items: list[GeneratorSessionResponse]
    total: int


class GeneratorSessionCreateRequest(BaseModel):
    template_id: uuid.UUID | None = None
    doc_type: str
    field_values: dict = {}
    title: str | None = None
    folder_id: uuid.UUID | None = None


class GeneratorSessionUpdateRequest(BaseModel):
    field_values: dict | None = None
    title: str | None = None
    folder_id: uuid.UUID | None = None
    # Cập nhật con trỏ nội dung sửa tay hiện tại (vd khi chọn 1 version).
    edited_html: str | None = None


class GeneratorSessionGenerateRequest(BaseModel):
    output_filename: str | None = None
    folder_id: uuid.UUID | None = None
    output_format: str = "docx"  # "docx" | "pdf"
    # Generate từ một VERSION đã lưu (ưu tiên). Hoặc truyền trực tiếp edited_html.
    version_id: uuid.UUID | None = None
    edited_html: str | None = None
    # Bỏ qua validation required fields — dùng khi user đã xác nhận tạo dù còn trường trống.
    skip_field_validation: bool = False


# ── Versions (chỉnh sửa tay WYSIWYG) ─────────────────────────────────────────

class GeneratorSessionVersionCreateRequest(BaseModel):
    edited_html: str
    field_values: dict = {}
    label: str | None = None


class GeneratorSessionVersionUpdateRequest(BaseModel):
    label: str | None = None


class GeneratorSessionVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID
    version_no: int
    label: str | None
    edited_html: str
    field_values: dict
    created_at: datetime


class GeneratorSessionVersionListResponse(BaseModel):
    items: list[GeneratorSessionVersionResponse]
    total: int


# ── AI đề xuất chỉnh sửa (block-based, mức a) ────────────────────────────────

class BlockEditOp(BaseModel):
    """Một thao tác chỉnh sửa AI đề xuất, chỉ ở mức TEXT (không chứa thẻ HTML).

    LLM trả về danh sách op này; backend áp dụng lên DOM giữ nguyên cấu trúc thẻ.
    """
    op: Literal["replace", "insert_after", "delete"]
    block_id: str
    # replace: nội dung mới cho block. insert_after: text của block mới.
    new_text: str | None = None
    text: str | None = None
    # Chỉ dùng cho insert_after.
    kind: Literal["paragraph", "heading", "list_item"] = "paragraph"
    # Backend điền (để FE hiển thị diff) — text gốc của block; bỏ qua khi apply.
    before_text: str | None = None


class AiReviseRequest(BaseModel):
    html: str
    instructions: list[str] = []


class AiReviseResponse(BaseModel):
    ops: list[BlockEditOp]
    # HTML đã áp dụng TẤT CẢ op (để FE preview nhanh khi Accept All).
    revised_html_all: str
    # NGUYÊN tài liệu với từng chỗ sửa highlight tại chỗ (track-changes inline).
    # Mỗi block thay đổi mang data-op="op-i"; chứa span .dg-diff-old/.dg-diff-new
    # + nút .dg-diff-actions (data-act accept|reject). FE render trực tiếp.
    diff_html: str = ""
    warnings: list[str] = []


class AiReviseApplyRequest(BaseModel):
    html: str
    ops: list[BlockEditOp]


class AiReviseApplyResponse(BaseModel):
    revised_html: str
    warnings: list[str] = []


class DocumentToTemplateRequest(BaseModel):
    document_id: uuid.UUID
    title: str | None = None


class DocumentToTemplateResponse(BaseModel):
    template_id: uuid.UUID
    title: str
    field_count: int
    # Số giá trị AI phát hiện (để FE báo "trích được field_count/detected_count").
    detected_count: int = 0
    template_fields: list[TemplateFieldResponse]
