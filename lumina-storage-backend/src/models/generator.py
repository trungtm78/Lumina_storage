import uuid

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base, TimestampMixin


class GeneratorSession(TimestampMixin, Base):
    __tablename__ = "generator_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users_user.id", ondelete="CASCADE"), nullable=False
    )
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents_document.id", ondelete="SET NULL"), nullable=True
    )
    doc_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    field_values: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="draft")
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents_document.id", ondelete="SET NULL"), nullable=True
    )
    # Folder chosen at save-for-later / generate time. Stored so a draft remembers
    # where the user intends to save it (drafts have no document yet to carry folder).
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents_folder.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # HTML đã sửa tay (con trỏ "nội dung đang làm việc hiện tại" / version đang chọn).
    # NULL = chưa sửa tay → generate theo luồng template + field.
    edited_html: Mapped[str | None] = mapped_column(Text, nullable=True)


class GeneratorSessionVersion(TimestampMixin, Base):
    """Lịch sử các bản chỉnh sửa tay (WYSIWYG) của một session.

    Mỗi lần "Lưu" trong editor → 1 version. Người dùng chọn version để tiếp tục
    làm việc / generate. Version chính là "template đang preview" tại thời điểm đó.
    """

    __tablename__ = "generator_session_versions"

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("generator_sessions.id", ondelete="CASCADE"), nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    edited_html: Mapped[str] = mapped_column(Text, nullable=False)
    field_values: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
