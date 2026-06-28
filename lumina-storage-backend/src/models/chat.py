import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, TimestampMixin

if False:
    from src.models.document import Document


class ChatSession(TimestampMixin, Base):
    __tablename__ = "chat_chatsession"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users_user.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str | None] = mapped_column(String(512))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_chatsession_user", "user_id", "deleted_at"),
    )

    messages: Mapped[list["ChatMessage"]] = relationship("ChatMessage", back_populates="session")


class ChatMessage(Base):
    __tablename__ = "chat_chatmessage"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("chat_chatsession.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tokens_used: Mapped[int | None] = mapped_column(Integer)
    model_used: Mapped[str | None] = mapped_column(String(100))
    skill_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    attachments: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("idx_chatmessage_session", "session_id", "created_at"),
    )

    session: Mapped["ChatSession"] = relationship("ChatSession", back_populates="messages")
    sources: Mapped[list["ChatMessageSource"]] = relationship("ChatMessageSource", back_populates="message")


class ChatMessageSource(Base):
    __tablename__ = "chat_chatmessagesource"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("chat_chatmessage.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents_document.id", ondelete="CASCADE"), nullable=False)
    chunk_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents_documentchunk.id", ondelete="SET NULL"))
    citation_index: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    page_number: Mapped[int | None] = mapped_column(Integer)
    relevance_score: Mapped[float | None] = mapped_column(Float)
    excerpt: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("idx_chatmessagesource_message", "message_id"),
    )

    message: Mapped["ChatMessage"] = relationship("ChatMessage", back_populates="sources")
    document: Mapped["Document"] = relationship("Document", lazy="selectin")
