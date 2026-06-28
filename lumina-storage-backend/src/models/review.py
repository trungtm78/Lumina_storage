import uuid
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base, TimestampMixin


class ReviewJobVersion(TimestampMixin, Base):
    """Snapshot of a single version within a review job.

    Created each time the user: runs AI review, applies suggestions,
    sends an AI loop request, or makes a manual edit.
    Allows reverting to any previous version.
    """

    __tablename__ = "review_reviewjobversion"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("review_reviewjob.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_num: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    version_type: Mapped[str] = mapped_column(String(32), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    review_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    result: Mapped[dict] = mapped_column(JSONB, nullable=False)

    __table_args__ = (
        Index("idx_reviewjobversion_job_num", "job_id", "version_num"),
    )


class ReviewJob(TimestampMixin, Base):
    """A single Document Review & Analysis run.

    Persists the entire report as JSONB for flexibility across schema iterations.
    """

    __tablename__ = "review_reviewjob"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users_user.id", ondelete="CASCADE"),
        nullable=False,
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents_document.id", ondelete="SET NULL"),
        nullable=True,
    )
    compare_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents_document.id", ondelete="SET NULL"),
        nullable=True,
    )
    document_name: Mapped[str] = mapped_column(String(512), nullable=False)
    review_type: Mapped[str] = mapped_column(String(32), nullable=False)
    compare_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # "reviewing" = AI đã phân tích, user đang làm việc với kết quả
    # "completed" = user đã đánh dấu hoàn tất
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="reviewing")
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Full ReviewReport serialized — keeps schema-flexible
    report: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # Session events timeline — persisted for reopen
    session_events: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")
    )
    # Pre-generated eval report PDF stored in Documents table (best-effort)
    pdf_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents_document.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Soft delete
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("idx_reviewjob_user_created", "user_id", "created_at"),
        Index("idx_reviewjob_user_deleted", "user_id", "deleted_at"),
    )
