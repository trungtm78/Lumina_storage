import logging
import mimetypes
import uuid
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import get_settings
from src.core.exceptions import BadRequestError, ForbiddenError, NotFoundError, PayloadTooLargeError
from src.core.file_validation import UPLOAD_ALLOWED_EXTENSIONS, validate_file_content
from src.models.document import Document
from src.models.storage import StorageConfig
from src.models.user import User
from src.repositories.document import DocumentRepository, FolderRepository, StorageConfigRepository
from src.schemas.document import DocumentResponse, DocumentUploadResponse, FolderResponse
from src.services.document_permission import DocumentPermissionService
from src.services.storage import get_storage_backend


# Default cap if a storage config doesn't specify one. Admin can override
# per-storage by setting `max_upload_size_mb` in the StorageConfig.config JSONB.
_DEFAULT_MAX_UPLOAD_SIZE_MB = 100


def _resolve_max_upload_size_mb(storage_config: StorageConfig) -> int:
    """Read the upload size limit (MB) for a storage config.

    Looks at `storage_config.config["max_upload_size_mb"]` (JSONB) first, falls
    back to the project-wide default. Different backends can carry different
    limits — e.g. allow bigger PDFs on S3 than on local disk.
    """
    cfg = storage_config.config or {}
    raw = cfg.get("max_upload_size_mb")
    try:
        value = int(raw) if raw is not None else _DEFAULT_MAX_UPLOAD_SIZE_MB
    except (TypeError, ValueError):
        value = _DEFAULT_MAX_UPLOAD_SIZE_MB
    return max(1, value)


class DocumentService:
    def __init__(self, session: AsyncSession) -> None:
        self.db = session
        self.doc_repo = DocumentRepository(session)
        self.folder_repo = FolderRepository(session)
        self.storage_config_repo = StorageConfigRepository(session)
        self.perm_svc = DocumentPermissionService(session)
        self.session = session

    async def _resolve_storage(
        self, storage_config_id: uuid.UUID | None, owner: User
    ):
        """Resolve storage config: use specified one or fall back to default."""
        if storage_config_id:
            config = await self.storage_config_repo.get_by_id(storage_config_id)
            if not config or not config.is_active:
                raise NotFoundError("Storage config not found or inactive")
            # User can only use their own configs or system-wide ones
            if config.owner_id is not None and config.owner_id != owner.id:
                raise ForbiddenError("Cannot use another user's storage config")
            return config, get_storage_backend(config)

        config = await self.storage_config_repo.get_default()
        if not config:
            raise BadRequestError("No default storage config. Ask admin to configure one.")
        return config, get_storage_backend(config)

    async def upload_files(
        self,
        files: list[UploadFile],
        folder_id: uuid.UUID | None,
        owner: User,
        storage_config_id: uuid.UUID | None = None,
        source_type: str = "upload",
    ) -> list[DocumentResponse]:
        if folder_id:
            folder = await self.folder_repo.get_by_id_active(folder_id)
            if not folder:
                raise NotFoundError("Folder not found")
            await self.perm_svc.check_permission(owner, folder_id=folder_id, required="editor")

        storage_config, backend = await self._resolve_storage(storage_config_id, owner)
        max_size_mb = _resolve_max_upload_size_mb(storage_config)
        max_size = max_size_mb * 1024 * 1024
        results = []

        for file in files:
            data = await file.read()
            if len(data) > max_size:
                raise PayloadTooLargeError(
                    f"File '{file.filename}' exceeds {max_size_mb}MB limit"
                )

            original_filename = file.filename or "unnamed"
            ext = Path(original_filename).suffix.lower()
            if ext not in UPLOAD_ALLOWED_EXTENSIONS:
                raise BadRequestError(
                    f"File extension {ext!r} is not allowed. "
                    f"Allowed: {', '.join(sorted(UPLOAD_ALLOWED_EXTENSIONS))}"
                )
            ok, sniffed = validate_file_content(data, original_filename)
            if not ok:
                raise BadRequestError(
                    f"File '{original_filename}' content does not match its extension "
                    f"(detected {sniffed})"
                )
            storage_result = await backend.save(data, original_filename)

            mime_type = file.content_type or mimetypes.guess_type(original_filename)[0] or "application/octet-stream"
            extension = Path(original_filename).suffix.lower()

            doc = await self.doc_repo.create({
                "title": Path(original_filename).stem,
                "file_name": storage_result.file_name,
                "original_filename": original_filename,
                "file_path": storage_result.file_path,
                "file_size": storage_result.file_size,
                "mime_type": mime_type,
                "extension": extension,
                "checksum": storage_result.checksum,
                "folder_id": folder_id,
                "storage_config_id": storage_config.id,
                "owner_id": owner.id,
                "source_type": source_type,
            })
            results.append(DocumentResponse.model_validate(doc))

        return results

    async def upload_folder(
        self,
        files: list[UploadFile],
        paths: list[str],
        parent_folder_id: uuid.UUID | None,
        owner: User,
        storage_config_id: uuid.UUID | None = None,
    ) -> DocumentUploadResponse:
        if len(files) != len(paths):
            raise BadRequestError("Number of files must match number of paths")

        # Determine root parent path
        parent_path = ""
        if parent_folder_id:
            parent = await self.folder_repo.get_by_id_active(parent_folder_id)
            if not parent:
                raise NotFoundError("Parent folder not found")
            await self.perm_svc.check_permission(owner, folder_id=parent_folder_id, required="editor")
            parent_path = parent.path

        storage_config, backend = await self._resolve_storage(storage_config_id, owner)
        max_size_mb = _resolve_max_upload_size_mb(storage_config)
        max_size = max_size_mb * 1024 * 1024

        # Build folder structure from paths and upload files
        folder_cache: dict[str, uuid.UUID] = {}
        root_folder = None
        documents = []

        for file, rel_path in zip(files, paths):
            # Parse directory parts from relative path
            parts = Path(rel_path).parts
            dir_parts = parts[:-1]  # all except filename

            # Create folder hierarchy
            current_parent_id = parent_folder_id
            current_parent_path = parent_path
            for i, part in enumerate(dir_parts):
                cache_key = "/".join(dir_parts[: i + 1])
                if cache_key in folder_cache:
                    folder = await self.folder_repo.get_by_id_active(folder_cache[cache_key])
                    current_parent_id = folder.id
                    current_parent_path = folder.path
                    continue

                folder = await self.folder_repo.get_or_create(
                    name=part,
                    parent_id=current_parent_id,
                    owner_id=owner.id,
                    path="",  # temporary
                )
                if not folder.path:
                    folder.path = f"{current_parent_path}/{folder.id}"
                folder_cache[cache_key] = folder.id
                current_parent_id = folder.id
                current_parent_path = folder.path

                if i == 0 and root_folder is None:
                    root_folder = folder

            # Upload file
            data = await file.read()
            if len(data) > max_size:
                raise PayloadTooLargeError(
                    f"File '{file.filename}' exceeds {max_size_mb}MB limit"
                )

            original_filename = file.filename or parts[-1] if parts else "unnamed"
            ext = Path(original_filename).suffix.lower()
            if ext not in UPLOAD_ALLOWED_EXTENSIONS:
                raise BadRequestError(
                    f"File extension {ext!r} is not allowed. "
                    f"Allowed: {', '.join(sorted(UPLOAD_ALLOWED_EXTENSIONS))}"
                )
            ok, sniffed = validate_file_content(data, original_filename)
            if not ok:
                raise BadRequestError(
                    f"File '{original_filename}' content does not match its extension "
                    f"(detected {sniffed})"
                )
            storage_result = await backend.save(data, original_filename)
            mime_type = file.content_type or mimetypes.guess_type(original_filename)[0] or "application/octet-stream"
            extension = Path(original_filename).suffix.lower()

            doc = await self.doc_repo.create({
                "title": Path(original_filename).stem,
                "file_name": storage_result.file_name,
                "original_filename": original_filename,
                "file_path": storage_result.file_path,
                "file_size": storage_result.file_size,
                "mime_type": mime_type,
                "extension": extension,
                "checksum": storage_result.checksum,
                "folder_id": current_parent_id,
                "storage_config_id": storage_config.id,
                "owner_id": owner.id,
                "source_type": "upload",
            })
            documents.append(DocumentResponse.model_validate(doc))

        return DocumentUploadResponse(
            documents=documents,
            folder=FolderResponse.model_validate(root_folder) if root_folder else None,
        )

    async def list_documents(
        self,
        owner: User,
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
        search_mode: str = "keyword",
        starred: bool | None = None,
        shared_with_me: bool | None = None,
        source_type: str | None = None,
    ) -> tuple[list[DocumentResponse], int]:
        semantic_doc_ids: list[uuid.UUID] | None = None

        if q and search_mode == "semantic":
            from src.core.config import get_settings as _get_settings
            from src.services.embedding_service import EmbeddingService
            from src.services.vector_service import VectorService
            settings = _get_settings()
            embedding_svc = await EmbeddingService.from_db_default(self.db)
            vector_svc = VectorService(settings)
            query_vec = await embedding_svc.embed_query(q)
            results = await vector_svc.search(query_vec, top_k=50)
            seen: set[uuid.UUID] = set()
            semantic_doc_ids = []
            for r in results:
                if r.document_id not in seen:
                    seen.add(r.document_id)
                    semantic_doc_ids.append(r.document_id)

        keyword_q = q if search_mode == "keyword" else None

        group_ids = await self.perm_svc.get_user_group_ids(owner)

        docs = await self.doc_repo.get_accessible_paginated(
            owner.id, group_ids, page, page_size, folder_id,
            extensions=extensions,
            uploader_id=uploader_id,
            sort_by=sort_by,
            sort_order=sort_order,
            start_date=start_date,
            end_date=end_date,
            q=keyword_q,
            semantic_doc_ids=semantic_doc_ids,
            starred=starred,
            shared_with_me=shared_with_me,
            source_type=source_type,
        )
        total = await self.doc_repo.count_accessible(
            owner.id, group_ids, folder_id,
            extensions=extensions,
            uploader_id=uploader_id,
            start_date=start_date,
            end_date=end_date,
            q=keyword_q,
            semantic_doc_ids=semantic_doc_ids,
            starred=starred,
            shared_with_me=shared_with_me,
            source_type=source_type,
        )
        owner_ids = {d.owner_id for d in docs if d.owner_id}
        uploader_names: dict[uuid.UUID, str] = {}
        if owner_ids:
            from sqlalchemy import select as _select
            rows = await self.db.execute(
                _select(User.id, User.full_name).where(User.id.in_(owner_ids))
            )
            uploader_names = {row.id: row.full_name for row in rows}

        responses = []
        for d in docs:
            r = DocumentResponse.model_validate(d)
            if d.owner_id:
                r.uploader_name = uploader_names.get(d.owner_id)
            responses.append(r)
        return responses, total

    async def list_trash(
        self,
        owner: User,
        page: int,
        page_size: int,
        sort_by: str = "updated_at",
        sort_order: str = "desc",
    ) -> tuple[list[DocumentResponse], int]:
        docs = await self.doc_repo.get_deleted_paginated(
            owner.id, page, page_size, sort_by=sort_by, sort_order=sort_order
        )
        total = await self.doc_repo.count_deleted(owner.id)
        return [DocumentResponse.model_validate(d) for d in docs], total

    async def restore_document(self, doc_id: uuid.UUID, owner: User) -> DocumentResponse:
        doc = await self.doc_repo.restore(doc_id, owner.id)
        if not doc:
            raise NotFoundError("Document not found in trash")
        return DocumentResponse.model_validate(doc)

    async def get_document(self, doc_id: uuid.UUID, owner: User) -> DocumentResponse:
        await self.perm_svc.check_permission(owner, document_id=doc_id, required="viewer")
        doc = await self.doc_repo.get_by_id_active(doc_id)
        if not doc:
            raise NotFoundError("Document not found")
        return DocumentResponse.model_validate(doc)

    async def get_thumbnail(self, doc_id: uuid.UUID, owner: User) -> bytes:
        await self.perm_svc.check_permission(owner, document_id=doc_id, required="viewer")
        doc = await self.doc_repo.get_by_id_active(doc_id)
        if not doc:
            raise NotFoundError("Document not found")
        if not doc.image_thumbnail:
            raise NotFoundError("Thumbnail not available")

        config = await self.storage_config_repo.get_by_id(doc.storage_config_id)
        if not config:
            raise NotFoundError("Storage config not found")

        backend = get_storage_backend(config)
        return await backend.read(doc.image_thumbnail)

    async def get_file_content(
        self, doc_id: uuid.UUID, owner: User
    ) -> tuple[bytes, "Document"]:
        from src.models.document import Document

        await self.perm_svc.check_permission(owner, document_id=doc_id, required="viewer")
        doc = await self.doc_repo.get_by_id_active(doc_id)
        if not doc:
            raise NotFoundError("Document not found")

        config = await self.storage_config_repo.get_by_id(doc.storage_config_id)
        if not config:
            raise NotFoundError("Storage config not found")

        backend = get_storage_backend(config)
        data = await backend.read(doc.file_path)
        return data, doc

    async def delete_document(self, doc_id: uuid.UUID, owner: User) -> None:
        from src.repositories.generator import GeneratorSessionRepository
        await self.perm_svc.check_permission(owner, document_id=doc_id, required="manager")
        doc = await self.doc_repo.get_by_id_active(doc_id)
        await self.doc_repo.soft_delete(doc_id)
        # Also soft-delete any template derived from this document
        await self._soft_delete_related_templates(doc_id)
        # If deleting a template, cascade-cancel draft sessions using it
        if doc and doc.source_type == "template":
            session_repo = GeneratorSessionRepository(self.doc_repo.session)
            await session_repo.soft_delete_drafts_by_template(doc_id)

    async def bulk_delete_documents(self, doc_ids: list[uuid.UUID], owner: User) -> int:
        deleted = 0
        for doc_id in doc_ids:
            try:
                await self.perm_svc.check_permission(owner, document_id=doc_id, required="manager")
            except (ForbiddenError, NotFoundError):
                continue
            result = await self.doc_repo.soft_delete(doc_id)
            if result is not None:
                deleted += 1
        return deleted

    async def permanent_delete_document(
        self, doc_id: uuid.UUID, owner: User, arq_pool
    ) -> None:
        doc = await self.doc_repo.get_deleted(doc_id, owner.id)
        if not doc:
            raise NotFoundError("Document not found in trash")
        await self._permanent_delete_and_dispatch(doc, arq_pool)

    async def bulk_permanent_delete(
        self, doc_ids: list[uuid.UUID], owner: User, arq_pool
    ) -> int:
        docs = await self.doc_repo.get_deleted_by_ids(doc_ids, owner.id)
        for doc in docs:
            await self._permanent_delete_and_dispatch(doc, arq_pool)
        return len(docs)

    async def _soft_delete_related_templates(self, doc_id: uuid.UUID) -> None:
        """Soft-delete any template documents derived from this source document."""
        from datetime import datetime, timezone
        from sqlalchemy import update
        from sqlalchemy.dialects.postgresql import JSONB

        session = self.doc_repo.session
        # Templates store source_document_id in source_metadata JSONB
        await session.execute(
            update(Document)
            .where(
                Document.source_type == "template",
                Document.deleted_at.is_(None),
                Document.source_metadata["source_document_id"].astext == str(doc_id),
            )
            .values(deleted_at=datetime.now(timezone.utc))
        )
        # Phase 3: commit ở boundary (get_db). delete_document gọi hàm này GIỮA chừng
        # (trước cascade-cancel drafts) → gỡ commit để cả delete là MỘT transaction,
        # tránh partial-commit nếu bước sau lỗi.
        await session.flush()

    async def _permanent_delete_related_templates(self, doc_id, session, arq_pool) -> None:
        """Hard-delete any template documents derived from this source document."""
        from sqlalchemy import select as sql_select

        result = await session.execute(
            sql_select(Document).where(
                Document.source_type == "template",
                Document.source_metadata["source_document_id"].astext == str(doc_id),
            )
        )
        templates = list(result.scalars().all())
        for tmpl in templates:
            tmpl_file_path = tmpl.file_path
            tmpl_storage_config_id = tmpl.storage_config_id
            tmpl_id = tmpl.id
            await session.delete(tmpl)
            await session.flush()
            # Cleanup storage file
            await arq_pool.enqueue_job(
                "cleanup_deleted_document_task",
                tmpl_id,
                tmpl_storage_config_id,
                tmpl_file_path,
                None,  # no thumbnail
                [],    # no versions
            )

    async def _permanent_delete_and_dispatch(self, doc, arq_pool) -> None:
        from sqlalchemy import delete as sql_delete, select as sql_select
        from src.models.document import DocumentVersion
        from src.models.processing import BackgroundTask
        from src.services.vector_service import VectorService

        session = self.doc_repo.session

        # Thu thập thông tin cần thiết trước khi xóa
        versions = await session.execute(
            sql_select(DocumentVersion).where(DocumentVersion.document_id == doc.id)
        )
        version_file_paths = [v.file_path for v in versions.scalars().all()]

        # Xóa BackgroundTask (không có FK, không CASCADE)
        await session.execute(
            sql_delete(BackgroundTask).where(
                BackgroundTask.related_type == "document",
                BackgroundTask.related_id == doc.id,
            )
        )

        doc_id = doc.id
        storage_config_id = doc.storage_config_id
        file_path = doc.file_path
        image_thumbnail = doc.image_thumbnail

        # If this is a template, remember its source so we can cascade-delete
        # the source raw upload when no templates remain pointing at it.
        source_doc_id: uuid.UUID | None = None
        if doc.source_type == "template":
            meta = doc.source_metadata or {}
            raw_source_id = meta.get("source_document_id")
            if raw_source_id:
                try:
                    source_doc_id = uuid.UUID(raw_source_id)
                except (ValueError, TypeError):
                    source_doc_id = None

        # Xóa Qdrant vectors ngay, trước khi DB delete
        try:
            vector_svc = VectorService(get_settings())
            await vector_svc.delete_by_document(doc_id)
        except Exception as e:
            logger.warning("_permanent_delete_and_dispatch: Qdrant delete failed for %s: %s", doc_id, e)

        # Hard delete related templates first
        await self._permanent_delete_related_templates(doc_id, session, arq_pool)

        # Hard delete — CASCADE tự xóa:
        # DocumentTag, DocumentVersion, DocumentContent, DocumentChunk
        await session.delete(doc)
        await session.flush()

        # Dispatch worker chỉ để xóa storage files
        await arq_pool.enqueue_job(
            "cleanup_deleted_document_task",
            doc_id,
            storage_config_id,
            file_path,
            image_thumbnail,
            version_file_paths,
        )

        # Template cascade: if deleting a template leaves its source with no
        # remaining templates, hard-delete the source upload too.
        if source_doc_id is not None:
            remaining = await session.execute(
                sql_select(Document.id).where(
                    Document.source_type == "template",
                    Document.deleted_at.is_(None),
                    Document.source_metadata["source_document_id"].astext == str(source_doc_id),
                )
            )
            if remaining.first() is None:
                source_doc = await session.get(Document, source_doc_id)
                if source_doc and source_doc.deleted_at is None:
                    logger.info(
                        "Cascade-deleting source upload %s (no templates remain)", source_doc_id,
                    )
                    await self._permanent_delete_and_dispatch(source_doc, arq_pool)

    async def move_document(
        self, doc_id: uuid.UUID, folder_id: uuid.UUID | None, owner: User
    ) -> DocumentResponse:
        doc = await self.doc_repo.get_by_id_active(doc_id)
        if not doc:
            raise NotFoundError("Document not found")
        if doc.owner_id != owner.id:
            raise ForbiddenError("Only the document owner can move it")
        if folder_id is not None:
            folder = await self.folder_repo.get_by_id_active(folder_id)
            if not folder:
                raise NotFoundError("Folder not found")
            await self.perm_svc.check_permission(owner, folder_id=folder_id, required="editor")
        updated = await self.doc_repo.move_to_folder(doc_id, folder_id)
        return DocumentResponse.model_validate(updated)

    async def rename_document(self, doc_id: uuid.UUID, title: str, owner: User) -> DocumentResponse:
        await self.perm_svc.check_permission(owner, document_id=doc_id, required="editor")
        updated = await self.doc_repo.update_title(doc_id, title)
        if not updated:
            from src.core.exceptions import NotFoundError
            raise NotFoundError("Document not found")
        return DocumentResponse.model_validate(updated)

    async def toggle_starred(self, doc_id: uuid.UUID, owner: User) -> DocumentResponse:
        await self.perm_svc.check_permission(owner, document_id=doc_id, required="editor")
        updated = await self.doc_repo.toggle_starred(doc_id)
        return DocumentResponse.model_validate(updated)
