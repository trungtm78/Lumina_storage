import uuid
from datetime import UTC, datetime

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.shared.models.document import Document, DocumentContent, DocumentPermission, Folder
from src.shared.models.storage import StorageConfig
from src.shared.repositories.base import BaseRepository

# source_types hidden from the main document list (used in both list and count queries)
_HIDDEN_SOURCE_TYPES = frozenset(["skill_temp", "template", "chat_attachment"])


class StorageConfigRepository(BaseRepository[StorageConfig]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(StorageConfig, session)

    async def get_default(self) -> StorageConfig | None:
        result = await self.session.execute(
            select(StorageConfig).where(
                StorageConfig.is_default.is_(True),
                StorageConfig.is_active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def get_active_list(self) -> list[StorageConfig]:
        result = await self.session.execute(
            select(StorageConfig).where(StorageConfig.is_active.is_(True))
        )
        return list(result.scalars().all())

    async def clear_default(self) -> None:
        """Remove is_default from all configs."""
        result = await self.session.execute(
            select(StorageConfig).where(StorageConfig.is_default.is_(True))
        )
        for config in result.scalars().all():
            config.is_default = False
        await self.session.flush()

    async def get_by_owner(self, owner_id: uuid.UUID) -> list[StorageConfig]:
        result = await self.session.execute(
            select(StorageConfig).where(
                StorageConfig.owner_id == owner_id,
                StorageConfig.is_active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def get_available_for_user(self, user_id: uuid.UUID) -> list[StorageConfig]:
        """Get configs available to a user: their own + system-wide (owner_id IS NULL)."""
        from sqlalchemy import or_
        result = await self.session.execute(
            select(StorageConfig).where(
                StorageConfig.is_active.is_(True),
                or_(
                    StorageConfig.owner_id == user_id,
                    StorageConfig.owner_id.is_(None),
                ),
            )
        )
        return list(result.scalars().all())


class FolderRepository(BaseRepository[Folder]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Folder, session)

    async def get_by_id_active(self, folder_id: uuid.UUID) -> Folder | None:
        result = await self.session.execute(
            select(Folder).where(
                Folder.id == folder_id,
                Folder.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_parent(
        self, parent_id: uuid.UUID | None, owner_id: uuid.UUID,
        group_ids: list[uuid.UUID] | None = None,
        shared_with_me: bool | None = None,
    ) -> list[Folder]:
        stmt = select(Folder).where(Folder.deleted_at.is_(None))

        if parent_id is None:
            stmt = stmt.where(Folder.parent_id.is_(None))
        else:
            stmt = stmt.where(Folder.parent_id == parent_id)

        group_ids = group_ids or []
        access_conditions = []

        if shared_with_me:
            stmt = stmt.where(Folder.owner_id != owner_id)
        else:
            access_conditions.append(Folder.owner_id == owner_id)

        # Build grantee conditions for both group and direct user ACL
        grantee_conds = []
        if group_ids:
            grantee_conds.append(DocumentPermission.group_id.in_(group_ids))
        grantee_conds.append(DocumentPermission.user_id == owner_id)
        grantee_clause = or_(*grantee_conds)

        # Direct ACL on this folder
        direct_folder_subq = (
            select(DocumentPermission.folder_id)
            .where(
                DocumentPermission.folder_id.is_not(None),
                grantee_clause,
            )
        )
        access_conditions.append(Folder.id.in_(direct_folder_subq))

        # Inherited: folder is descendant of a shared ancestor
        parent_folder = Folder.__table__.alias("pf")
        inherited_subq = (
            select(Folder.id).where(
                select(func.count()).select_from(parent_folder).join(
                    DocumentPermission,
                    DocumentPermission.folder_id == parent_folder.c.id,
                ).where(
                    grantee_clause,
                    Folder.path.like(parent_folder.c.path + "/%"),
                ).correlate(Folder).scalar_subquery() > 0
            )
        )
        access_conditions.append(Folder.id.in_(inherited_subq))

        stmt = stmt.where(or_(*access_conditions))
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_children(self, folder_id: uuid.UUID) -> list[Folder]:
        result = await self.session.execute(
            select(Folder).where(
                Folder.parent_id == folder_id,
                Folder.deleted_at.is_(None),
            )
        )
        return list(result.scalars().all())

    async def get_or_create(
        self, name: str, parent_id: uuid.UUID | None, owner_id: uuid.UUID, path: str
    ) -> Folder:
        stmt = select(Folder).where(
            Folder.name == name,
            Folder.owner_id == owner_id,
            Folder.deleted_at.is_(None),
        )
        if parent_id is None:
            stmt = stmt.where(Folder.parent_id.is_(None))
        else:
            stmt = stmt.where(Folder.parent_id == parent_id)

        result = await self.session.execute(stmt)
        folder = result.scalar_one_or_none()
        if folder:
            return folder

        return await self.create({
            "name": name,
            "parent_id": parent_id,
            "owner_id": owner_id,
            "path": path,
        })

    async def rename(self, folder: Folder, name: str) -> Folder:
        folder.name = name
        await self.session.flush()
        return folder

    async def soft_delete_subtree(self, folder: Folder) -> None:
        """Soft delete a folder and all its descendants by path prefix."""
        now = datetime.now(UTC)
        folder.deleted_at = now
        # Delete all children matching the path prefix
        result = await self.session.execute(
            select(Folder).where(
                Folder.path.like(f"{folder.path}%"),
                Folder.deleted_at.is_(None),
                Folder.id != folder.id,
            )
        )
        for child in result.scalars().all():
            child.deleted_at = now
        await self.session.flush()


class DocumentRepository(BaseRepository[Document]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Document, session)

    async def get_by_id_active(self, doc_id: uuid.UUID) -> Document | None:
        result = await self.session.execute(
            select(Document).where(
                Document.id == doc_id,
                Document.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_folder(self, folder_id: uuid.UUID) -> list[Document]:
        result = await self.session.execute(
            select(Document).where(
                Document.folder_id == folder_id,
                Document.deleted_at.is_(None),
            )
        )
        return list(result.scalars().all())

    # ── Agent workspace queries (Phase 7: thay sa_text, GIỮ NGUYÊN semantics) ──

    async def search_workspace_files(
        self, user_id: uuid.UUID, q: str, limit: int = 10
    ) -> list[Document]:
        """File workspace của user theo từ khóa (exclude CHỈ skill_temp). (agent.search_files)"""
        like = f"%{q}%"
        result = await self.session.execute(
            select(Document)
            .where(
                Document.owner_id == user_id,
                Document.deleted_at.is_(None),
                or_(Document.source_type.is_(None), Document.source_type.notin_(["skill_temp"])),
                or_(Document.title.ilike(like), Document.original_filename.ilike(like)),
            )
            .order_by(Document.updated_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def list_workspace_files(
        self,
        user_id: uuid.UUID,
        *,
        extensions: list[str] | None = None,
        q: str | None = None,
        limit: int = 20,
    ) -> list[Document]:
        """File workspace (exclude skill_temp + template; lọc extension/từ khóa). (agent.list_directory)"""
        conds = [
            Document.owner_id == user_id,
            Document.deleted_at.is_(None),
            or_(Document.source_type.is_(None), Document.source_type.notin_(["skill_temp", "template"])),
        ]
        if extensions:
            # Dual-expansion: chấp nhận cả 'docx' lẫn '.docx' (khớp raw cũ).
            all_exts = list(extensions) + [f".{e}" for e in extensions]
            conds.append(Document.extension.in_(all_exts))
        if q:
            like = f"%{q}%"
            conds.append(or_(Document.title.ilike(like), Document.original_filename.ilike(like)))
        result = await self.session.execute(
            select(Document).where(*conds).order_by(Document.updated_at.desc()).limit(limit)
        )
        return list(result.scalars().all())

    async def search_owned_templates(
        self, user_id: uuid.UUID, q: str, limit: int = 5
    ) -> list[Document]:
        """Template (source_type='template') của user; ILIKE title/description/filename. (agent.search_templates)"""
        like = f"%{q}%"
        result = await self.session.execute(
            select(Document)
            .where(
                Document.owner_id == user_id,
                Document.source_type == "template",
                Document.deleted_at.is_(None),
                or_(
                    Document.title.ilike(like),
                    Document.description.ilike(like),
                    Document.original_filename.ilike(like),
                ),
            )
            .order_by(Document.updated_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_accessible_paginated(
        self,
        user_id: uuid.UUID,
        group_ids: list[uuid.UUID],
        page: int,
        page_size: int,
        folder_id: uuid.UUID | None = ...,
        extensions: list[str] | None = None,
        uploader_id: uuid.UUID | None = None,
        sort_by: str = "updated_at",
        sort_order: str = "desc",
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        q: str | None = None,
        semantic_doc_ids: list[uuid.UUID] | None = None,
        starred: bool | None = None,
        shared_with_me: bool | None = None,
        source_type: str | None = None,
    ) -> list[Document]:
        if semantic_doc_ids is not None and len(semantic_doc_ids) == 0:
            return []

        offset = (page - 1) * page_size

        stmt = select(Document).where(
            Document.deleted_at.is_(None),
            # Hide internal files from main document list
            Document.source_type.notin_(_HIDDEN_SOURCE_TYPES),
        )

        if source_type is not None:
            stmt = stmt.where(Document.source_type == source_type)

        if shared_with_me:
            stmt = stmt.where(Document.owner_id != user_id)
            stmt = stmt.where(self._build_acl_only_filter(group_ids, user_id))
        elif uploader_id:
            stmt = stmt.where(Document.owner_id == uploader_id)
            stmt = stmt.where(self._build_acl_filter(user_id, group_ids))
        else:
            stmt = stmt.where(self._build_acl_filter(user_id, group_ids))

        if starred is not None:
            stmt = stmt.where(Document.starred == starred)

        if folder_id is None:
            stmt = stmt.where(Document.folder_id.is_(None))
        elif folder_id is not ...:
            stmt = stmt.where(Document.folder_id == folder_id)

        if extensions:
            stmt = stmt.where(Document.extension.in_(extensions))

        if start_date:
            stmt = stmt.where(Document.updated_at >= start_date)
        if end_date:
            stmt = stmt.where(Document.updated_at <= end_date)

        if semantic_doc_ids is not None:
            stmt = stmt.where(Document.id.in_(semantic_doc_ids))
        elif q:
            stmt = stmt.outerjoin(DocumentContent, DocumentContent.document_id == Document.id)
            # unaccent both query and indexed text so accent-insensitive search works for Vietnamese
            tsq = func.plainto_tsquery("simple", func.unaccent(q))
            stmt = stmt.where(
                or_(
                    func.to_tsvector("simple", func.unaccent(Document.title)).op("@@")(tsq),
                    DocumentContent.search_vector.op("@@")(tsq),
                )
            )

        sort_col = Document.updated_at if sort_by == "updated_at" else Document.created_at
        stmt = stmt.order_by(sort_col.desc() if sort_order == "desc" else sort_col.asc())

        stmt = stmt.offset(offset).limit(page_size)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_accessible_ids(
        self,
        user_id: uuid.UUID,
        group_ids: list[uuid.UUID],
    ) -> list[uuid.UUID]:
        """Return all document IDs the user can access (for RAG filtering)."""
        stmt = select(Document.id).where(Document.deleted_at.is_(None))
        stmt = stmt.where(self._build_acl_filter(user_id, group_ids))
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_acl_only_ids(
        self,
        user_id: uuid.UUID,
        group_ids: list[uuid.UUID],
    ) -> list[uuid.UUID]:
        """Return doc IDs accessible via ACL only (excludes owned docs).
        Used with owner_id Qdrant filter for optimized RAG search."""
        if not group_ids:
            return []

        stmt = (
            select(Document.id)
            .where(
                Document.deleted_at.is_(None),
                Document.owner_id != user_id,
                self._build_acl_only_filter(group_ids),
            )
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count_accessible(
        self,
        user_id: uuid.UUID,
        group_ids: list[uuid.UUID],
        folder_id: uuid.UUID | None = ...,
        extensions: list[str] | None = None,
        uploader_id: uuid.UUID | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        q: str | None = None,
        semantic_doc_ids: list[uuid.UUID] | None = None,
        starred: bool | None = None,
        shared_with_me: bool | None = None,
        source_type: str | None = None,
    ) -> int:
        if semantic_doc_ids is not None and len(semantic_doc_ids) == 0:
            return 0

        stmt = select(func.count(Document.id)).where(
            Document.deleted_at.is_(None),
            Document.source_type.notin_(_HIDDEN_SOURCE_TYPES),
        )

        if source_type is not None:
            stmt = stmt.where(Document.source_type == source_type)

        if shared_with_me:
            stmt = stmt.where(Document.owner_id != user_id)
            stmt = stmt.where(self._build_acl_only_filter(group_ids, user_id))
        elif uploader_id:
            stmt = stmt.where(Document.owner_id == uploader_id)
            stmt = stmt.where(self._build_acl_filter(user_id, group_ids))
        else:
            stmt = stmt.where(self._build_acl_filter(user_id, group_ids))

        if starred is not None:
            stmt = stmt.where(Document.starred == starred)

        if folder_id is None:
            stmt = stmt.where(Document.folder_id.is_(None))
        elif folder_id is not ...:
            stmt = stmt.where(Document.folder_id == folder_id)

        if extensions:
            stmt = stmt.where(Document.extension.in_(extensions))

        if start_date:
            stmt = stmt.where(Document.updated_at >= start_date)
        if end_date:
            stmt = stmt.where(Document.updated_at <= end_date)

        if semantic_doc_ids is not None:
            stmt = stmt.where(Document.id.in_(semantic_doc_ids))
        elif q:
            stmt = stmt.outerjoin(DocumentContent, DocumentContent.document_id == Document.id)
            tsq = func.plainto_tsquery("simple", func.unaccent(q))
            stmt = stmt.where(
                or_(
                    func.to_tsvector("simple", func.unaccent(Document.title)).op("@@")(tsq),
                    DocumentContent.search_vector.op("@@")(tsq),
                )
            )

        result = await self.session.execute(stmt)
        return result.scalar_one()

    async def get_deleted_paginated(
        self,
        owner_id: uuid.UUID,
        page: int,
        page_size: int,
        sort_by: str = "updated_at",
        sort_order: str = "desc",
    ) -> list[Document]:
        offset = (page - 1) * page_size
        sort_col = Document.updated_at if sort_by == "updated_at" else Document.created_at
        stmt = (
            select(Document)
            .where(Document.owner_id == owner_id, Document.deleted_at.is_not(None))
            .order_by(sort_col.desc() if sort_order == "desc" else sort_col.asc())
            .offset(offset)
            .limit(page_size)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count_deleted(self, owner_id: uuid.UUID) -> int:
        stmt = select(func.count(Document.id)).where(
            Document.owner_id == owner_id,
            Document.deleted_at.is_not(None),
        )
        result = await self.session.execute(stmt)
        return result.scalar_one()

    async def get_deleted(self, doc_id: uuid.UUID, owner_id: uuid.UUID) -> Document | None:
        result = await self.session.execute(
            select(Document).where(
                Document.id == doc_id,
                Document.owner_id == owner_id,
                Document.deleted_at.is_not(None),
            )
        )
        return result.scalar_one_or_none()

    async def get_deleted_by_ids(self, doc_ids: list[uuid.UUID], owner_id: uuid.UUID) -> list[Document]:
        result = await self.session.execute(
            select(Document).where(
                Document.id.in_(doc_ids),
                Document.owner_id == owner_id,
                Document.deleted_at.is_not(None),
            )
        )
        return list(result.scalars().all())

    async def restore(self, doc_id: uuid.UUID, owner_id: uuid.UUID) -> Document | None:
        result = await self.session.execute(
            select(Document).where(
                Document.id == doc_id,
                Document.owner_id == owner_id,
                Document.deleted_at.is_not(None),
            )
        )
        doc = result.scalar_one_or_none()
        if doc is None:
            return None
        doc.deleted_at = None
        await self.session.flush()
        return doc

    async def soft_delete(self, doc_id: uuid.UUID) -> Document | None:
        doc = await self.get_by_id_active(doc_id)
        if doc is None:
            return None
        doc.deleted_at = datetime.now(UTC)
        await self.session.flush()
        return doc

    async def bulk_soft_delete(self, doc_ids: list[uuid.UUID], owner_id: uuid.UUID) -> int:
        now = datetime.now(UTC)
        stmt = (
            update(Document)
            .where(
                Document.id.in_(doc_ids),
                Document.owner_id == owner_id,
                Document.deleted_at.is_(None),
            )
            .values(deleted_at=now)
        )
        result = await self.session.execute(stmt)
        await self.session.flush()
        return result.rowcount

    async def move_to_folder(self, doc_id: uuid.UUID, folder_id: uuid.UUID | None) -> Document | None:
        doc = await self.get_by_id_active(doc_id)
        if doc is None:
            return None
        doc.folder_id = folder_id
        await self.session.flush()
        return doc

    async def update_title(self, doc_id: uuid.UUID, title: str) -> Document | None:
        doc = await self.get_by_id_active(doc_id)
        if doc is None:
            return None
        doc.title = title
        await self.session.flush()
        return doc

    async def toggle_starred(self, doc_id: uuid.UUID) -> Document | None:
        doc = await self.get_by_id_active(doc_id)
        if doc is None:
            return None
        doc.starred = not doc.starred
        await self.session.flush()
        return doc

    @staticmethod
    def _build_acl_only_filter(group_ids: list[uuid.UUID], user_id: uuid.UUID | None = None):
        """ACL filter excluding ownership — checks group and/or direct user permissions."""
        grantee_conds = []
        if group_ids:
            grantee_conds.append(DocumentPermission.group_id.in_(group_ids))
        if user_id:
            grantee_conds.append(DocumentPermission.user_id == user_id)

        if not grantee_conds:
            from sqlalchemy import false
            return false()

        grantee_clause = or_(*grantee_conds)

        # Direct ACL on document
        direct_subq = (
            select(DocumentPermission.document_id)
            .where(
                DocumentPermission.document_id.is_not(None),
                grantee_clause,
            )
        )

        # Folder ACL (direct + inherited)
        parent_folder = Folder.__table__.alias("pf")
        shared_folder_subq = (
            select(DocumentPermission.folder_id)
            .where(
                DocumentPermission.folder_id.is_not(None),
                grantee_clause,
            )
        )
        inherited_folder_subq = (
            select(Folder.id).where(
                select(func.count()).select_from(parent_folder).join(
                    DocumentPermission,
                    DocumentPermission.folder_id == parent_folder.c.id,
                ).where(
                    grantee_clause,
                    Folder.path.like(parent_folder.c.path + "/%"),
                ).correlate(Folder).scalar_subquery() > 0
            )
        )

        return or_(
            Document.id.in_(direct_subq),
            Document.folder_id.in_(shared_folder_subq),
            Document.folder_id.in_(inherited_folder_subq),
        )

    @staticmethod
    def _build_acl_filter(user_id: uuid.UUID, group_ids: list[uuid.UUID]):
        """Build OR clause: owner OR direct doc ACL OR folder ACL (incl. inherited)."""
        return or_(
            Document.owner_id == user_id,
            DocumentRepository._build_acl_only_filter(group_ids, user_id),
        )
