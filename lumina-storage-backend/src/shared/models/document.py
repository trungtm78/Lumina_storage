import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.shared.models.base import Base, TimestampMixin


class Folder(TimestampMixin, Base):
    __tablename__ = "documents_folder"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents_folder.id", ondelete="CASCADE"))
    path: Mapped[str] = mapped_column(String(2048), nullable=False, server_default="")
    owner_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users_user.id", ondelete="SET NULL"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_folder_parent", "parent_id"),
        Index("idx_folder_path", "path"),
    )

    children: Mapped[list["Folder"]] = relationship("Folder", back_populates="parent", foreign_keys="[Folder.parent_id]")
    parent: Mapped["Folder | None"] = relationship("Folder", back_populates="children", foreign_keys="[Folder.parent_id]", remote_side="[Folder.id]")


class Tag(Base):
    __tablename__ = "documents_tag"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    color: Mapped[str] = mapped_column(String(7), nullable=False, server_default="#808080")
    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Document(TimestampMixin, Base):
    __tablename__ = "documents_document"

    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    file_name: Mapped[str] = mapped_column(String(512), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    file_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=False)
    extension: Mapped[str] = mapped_column(String(50), nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    folder_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents_folder.id", ondelete="SET NULL"))
    storage_config_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("storage_storageconfig.id", ondelete="RESTRICT"), nullable=False)
    owner_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users_user.id", ondelete="SET NULL"))
    source_type: Mapped[str] = mapped_column(String(30), nullable=False, server_default="upload")
    source_metadata: Mapped[dict | None] = mapped_column(JSONB)
    page_count: Mapped[int | None] = mapped_column(Integer)
    language: Mapped[str | None] = mapped_column(String(20))
    # Phase 5a blue/green: con trỏ version ingest đang PHỤC VỤ. Swap nguyên tử tại DB
    # commit cuối ingest. reads lọc chunk theo version này (R2). NULL = chưa ingest xong.
    active_ingest_version: Mapped[str | None] = mapped_column(Text)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    starred: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    image_thumbnail: Mapped[str | None] = mapped_column(String(2048))

    __table_args__ = (
        Index("idx_document_folder", "folder_id"),
        Index("idx_document_owner", "owner_id"),
        Index("idx_document_created", "created_at"),
        Index("idx_document_deleted", "deleted_at"),
    )

    tags: Mapped[list["DocumentTag"]] = relationship("DocumentTag", back_populates="document", passive_deletes=True)
    versions: Mapped[list["DocumentVersion"]] = relationship("DocumentVersion", back_populates="document", passive_deletes=True)
    content: Mapped["DocumentContent | None"] = relationship("DocumentContent", back_populates="document", uselist=False, passive_deletes=True)
    chunks: Mapped[list["DocumentChunk"]] = relationship("DocumentChunk", back_populates="document", passive_deletes=True)


class DocumentTag(Base):
    __tablename__ = "documents_documenttag"

    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents_document.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents_tag.id", ondelete="CASCADE"), primary_key=True)

    document: Mapped["Document"] = relationship("Document", back_populates="tags")
    tag: Mapped["Tag"] = relationship("Tag")


class DocumentVersion(Base):
    __tablename__ = "documents_documentversion"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents_document.id", ondelete="CASCADE"), nullable=False)
    version_num: Mapped[int] = mapped_column(Integer, nullable=False)
    file_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    change_note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users_user.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("document_id", "version_num", name="uq_documentversion_doc_version"),
    )

    document: Mapped["Document"] = relationship("Document", back_populates="versions")


class DocumentContent(Base):
    __tablename__ = "documents_documentcontent"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents_document.id", ondelete="CASCADE"), nullable=False, unique=True)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    search_vector: Mapped[str | None] = mapped_column(TSVECTOR)
    language: Mapped[str | None] = mapped_column(String(20))
    extracted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        Index("idx_documentcontent_fts", "search_vector", postgresql_using="gin"),
    )

    document: Mapped["Document"] = relationship("Document", back_populates="content")


class DocumentChunk(Base):
    __tablename__ = "documents_documentchunk"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("documents_document.id", ondelete="CASCADE"), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int | None] = mapped_column(Integer)
    page_number: Mapped[int | None] = mapped_column(Integer)
    qdrant_point_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), unique=True)
    # Phase 5a blue/green: version ingest gắn mỗi chunk. 2 version cùng (doc, index) coexist
    # trong cửa sổ swap → version VÀO unique key. reads lọc theo document.active_ingest_version.
    # NOT NULL + server_default 'legacy' (codex P2): tránh NULL bypass unique + reads NULL==NULL
    # miss; current ingest chưa set version vẫn lấp 'legacy' qua default, T1 set version thật.
    ingest_version: Mapped[str] = mapped_column(Text, nullable=False, server_default="legacy")
    # Phase 5a A1: FTS chunk-level (to_tsvector('simple', unaccent(content))) cho hybrid retrieval.
    search_vector: Mapped[str | None] = mapped_column(TSVECTOR)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", "ingest_version", name="uq_documentchunk_doc_index_version"),
        Index("idx_documentchunk_document", "document_id"),
        Index("idx_documentchunk_fts", "search_vector", postgresql_using="gin"),
    )

    document: Mapped["Document"] = relationship("Document", back_populates="chunks")


class DocumentPermission(Base):
    __tablename__ = "documents_documentpermission"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents_document.id", ondelete="CASCADE")
    )
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents_folder.id", ondelete="CASCADE")
    )
    group_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("groups_group.id", ondelete="CASCADE"), nullable=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users_user.id", ondelete="CASCADE"), nullable=True
    )
    permission: Mapped[str] = mapped_column(String(10), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users_user.id"), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            "(document_id IS NOT NULL AND folder_id IS NULL) OR (document_id IS NULL AND folder_id IS NOT NULL)",
            name="chk_docperm_target",
        ),
        CheckConstraint(
            "(group_id IS NOT NULL AND user_id IS NULL) OR (group_id IS NULL AND user_id IS NOT NULL)",
            name="chk_docperm_grantee",
        ),
        Index("idx_docperm_document", "document_id"),
        Index("idx_docperm_folder", "folder_id"),
        Index("idx_docperm_group", "group_id"),
        Index("idx_docperm_user", "user_id"),
        Index(
            "uq_docperm_doc_group",
            "document_id",
            "group_id",
            unique=True,
            postgresql_where=(document_id.is_not(None) & group_id.is_not(None)),
        ),
        Index(
            "uq_docperm_doc_user",
            "document_id",
            "user_id",
            unique=True,
            postgresql_where=(document_id.is_not(None) & user_id.is_not(None)),
        ),
        Index(
            "uq_docperm_folder_group",
            "folder_id",
            "group_id",
            unique=True,
            postgresql_where=(folder_id.is_not(None) & group_id.is_not(None)),
        ),
        Index(
            "uq_docperm_folder_user",
            "folder_id",
            "user_id",
            unique=True,
            postgresql_where=(folder_id.is_not(None) & user_id.is_not(None)),
        ),
    )
