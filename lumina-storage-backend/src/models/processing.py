import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base


class ProcessingJob(Base):
    __tablename__ = "processing_processingjob"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents_document.id", ondelete="CASCADE"), nullable=False)
    job_type: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="pending")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, server_default="5")
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, server_default="3")
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default="now()")

    __table_args__ = (
        Index("idx_processingjob_doc_type", "document_id", "job_type"),
        Index(
            "idx_processingjob_queue",
            "status",
            "priority",
            postgresql_where="status = 'pending'",
        ),
    )


class BackgroundTask(Base):
    __tablename__ = "processing_backgroundtask"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    task_name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="pending")
    owner_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users_user.id", ondelete="SET NULL"))
    related_type: Mapped[str | None] = mapped_column(String(50))
    related_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    # Phase 8 T3: correlation/request-id từ API (asgi-correlation-id) → propagate vào worker
    # log để nối chuỗi trace API→background job.
    request_id: Mapped[str | None] = mapped_column(String(255))
    result: Mapped[dict | None] = mapped_column(JSONB)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default="now()")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_backgroundtask_job_id", "job_id"),
        Index("idx_backgroundtask_owner", "owner_id"),
        # Phase 8 T1: chống concurrent double-enqueue — chỉ 1 task in-flight (pending/running)
        # cho mỗi (task_name, related_id). Insert thứ 2 đồng thời → IntegrityError → dispatch
        # bắt + trả task đang chạy (atomic, diệt TOCTOU; tránh clobber active_ingest_version).
        Index(
            "uq_backgroundtask_inflight",
            "task_name",
            "related_id",
            unique=True,
            postgresql_where=text("status IN ('pending', 'running')"),
        ),
    )

    owner: Mapped["User | None"] = relationship("User")
