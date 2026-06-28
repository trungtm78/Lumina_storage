import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import and_, func, select
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.core import AuditLog
from src.models.document import Document, DocumentPermission
from src.models.processing import BackgroundTask
from src.models.user import User
from src.repositories.document import DocumentRepository, _HIDDEN_SOURCE_TYPES

_DOC_EXTENSIONS = frozenset({"pdf", "doc", "docx", "txt", "odt", "rtf"})
_SHEET_EXTENSIONS = frozenset({"xls", "xlsx", "csv", "ods"})
_PRES_EXTENSIONS = frozenset({"ppt", "pptx", "odp", "key"})


class DashboardRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_storage_used_bytes(self, user_id: uuid.UUID) -> int:
        result = await self.session.execute(
            select(func.coalesce(func.sum(Document.file_size), 0)).where(
                Document.owner_id == user_id,
                Document.deleted_at.is_(None),
                Document.source_type.notin_(_HIDDEN_SOURCE_TYPES),
            )
        )
        return int(result.scalar_one())

    async def get_storage_breakdown(self, user_id: uuid.UUID) -> dict[str, int]:
        stmt = (
            select(Document.extension, func.sum(Document.file_size).label("total"))
            .where(
                Document.owner_id == user_id,
                Document.deleted_at.is_(None),
                Document.source_type.notin_(_HIDDEN_SOURCE_TYPES),
            )
            .group_by(Document.extension)
        )
        result = await self.session.execute(stmt)

        docs = sheets = pres = other = 0
        for ext, total in result.all():
            ext_lower = (ext or "").lower().lstrip(".")
            total = int(total or 0)
            if ext_lower in _DOC_EXTENSIONS:
                docs += total
            elif ext_lower in _SHEET_EXTENSIONS:
                sheets += total
            elif ext_lower in _PRES_EXTENSIONS:
                pres += total
            else:
                other += total

        return {
            "documents_bytes": docs,
            "spreadsheets_bytes": sheets,
            "presentations_bytes": pres,
            "other_bytes": other,
        }

    async def get_processing_stats(self, user_id: uuid.UUID) -> dict[str, int]:
        stmt = (
            select(BackgroundTask.status, func.count(BackgroundTask.id).label("cnt"))
            .where(
                BackgroundTask.owner_id == user_id,
                BackgroundTask.related_type == "document",
            )
            .group_by(BackgroundTask.status)
        )
        result = await self.session.execute(stmt)

        raw: dict[str, int] = {}
        for status, cnt in result.all():
            raw[(status or "").lower()] = int(cnt)

        queued = raw.get("pending", 0)
        processing = raw.get("running", 0)
        completed = raw.get("success", 0)
        failed = raw.get("failure", 0)

        return {
            "total": queued + processing + completed + failed + raw.get("revoked", 0),
            "queued": queued,
            "processing": processing,
            "completed": completed,
            "failed": failed,
        }

    async def get_shared_by_me_count(self, user_id: uuid.UUID) -> int:
        shared_doc_ids = (
            select(DocumentPermission.document_id)
            .where(DocumentPermission.document_id.is_not(None))
            .distinct()
            .scalar_subquery()
        )
        result = await self.session.execute(
            select(func.count(Document.id)).where(
                Document.owner_id == user_id,
                Document.deleted_at.is_(None),
                Document.source_type.notin_(_HIDDEN_SOURCE_TYPES),
                Document.id.in_(shared_doc_ids),
            )
        )
        return int(result.scalar_one())

    async def count_owned_created_since(self, user_id: uuid.UUID, since: datetime) -> int:
        result = await self.session.execute(
            select(func.count(Document.id)).where(
                Document.owner_id == user_id,
                Document.deleted_at.is_(None),
                Document.source_type.notin_(_HIDDEN_SOURCE_TYPES),
                Document.created_at >= since,
            )
        )
        return int(result.scalar_one())

    async def get_activity_stats(self, user_id: uuid.UUID) -> dict[str, int]:
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        stmt = (
            select(AuditLog.action, func.count(AuditLog.id).label("cnt"))
            .where(AuditLog.user_id == user_id, AuditLog.created_at >= today_start)
            .group_by(AuditLog.action)
        )
        result = await self.session.execute(stmt)

        counts: dict[str, int] = {}
        for action, cnt in result.all():
            counts[action] = int(cnt)

        return {
            "total_today": sum(counts.values()),
            "uploaded_today": counts.get("document.upload", 0),
            "viewed_today": counts.get("document.view", 0),
            "shared_today": counts.get("document.share", 0),
        }

    async def get_recent_files(
        self,
        user_id: uuid.UUID,
        group_ids: list[uuid.UUID],
        limit: int = 6,
    ) -> list[dict]:
        OwnerUser = aliased(User)
        acl_filter = DocumentRepository._build_acl_filter(user_id, group_ids)
        stmt = (
            select(Document, OwnerUser)
            .outerjoin(OwnerUser, OwnerUser.id == Document.owner_id)
            .where(
                Document.deleted_at.is_(None),
                Document.source_type.notin_(_HIDDEN_SOURCE_TYPES),
                acl_filter,
            )
            .order_by(Document.updated_at.desc())
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return [
            {
                "id": str(doc.id),
                "title": doc.title,
                "extension": doc.extension,
                "owner_name": user.full_name if user else None,
                "updated_at": doc.updated_at.isoformat(),
            }
            for doc, user in result.all()
        ]

    async def get_processing_data(self, user_id: uuid.UUID, limit: int = 6) -> list[dict]:
        stmt = (
            select(BackgroundTask, Document)
            .outerjoin(
                Document,
                and_(
                    Document.id == BackgroundTask.related_id,
                    BackgroundTask.related_type == "document",
                ),
            )
            .where(
                BackgroundTask.owner_id == user_id,
                BackgroundTask.related_type == "document",
                BackgroundTask.task_name == "ingest_document",
            )
            .order_by(BackgroundTask.created_at.desc())
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return [
            {
                "id": str(task.id),
                "document_id": str(doc.id) if doc else None,
                "file_name": doc.title if doc else "Unknown",
                "extension": doc.extension if doc else "",
                "status": task.status,
                "created_at": task.created_at.isoformat(),
            }
            for task, doc in result.all()
        ]

    async def get_shared_files(
        self,
        user_id: uuid.UUID,
        group_ids: list[uuid.UUID],
        limit: int = 6,
    ) -> list[dict]:
        if not group_ids:
            return []

        OwnerUser = aliased(User)
        acl_only = DocumentRepository._build_acl_only_filter(group_ids)
        stmt = (
            select(Document, OwnerUser)
            .outerjoin(OwnerUser, OwnerUser.id == Document.owner_id)
            .where(
                Document.deleted_at.is_(None),
                Document.source_type.notin_(_HIDDEN_SOURCE_TYPES),
                Document.owner_id != user_id,
                acl_only,
            )
            .order_by(Document.updated_at.desc())
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return [
            {
                "id": str(doc.id),
                "title": doc.title,
                "extension": doc.extension,
                "owner_name": user.full_name if user else None,
                "updated_at": doc.updated_at.isoformat(),
            }
            for doc, user in result.all()
        ]
