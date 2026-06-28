import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from src.models.user import User
from src.repositories.dashboard import DashboardRepository
from src.repositories.document import DocumentRepository
from src.services.system_config import SystemConfigService
from src.schemas.dashboard import (
    ActivityStats,
    DashboardStatsResponse,
    DocumentCountStats,
    ProcessingStats,
    SharedStats,
    StorageBreakdown,
    StorageStats,
)
from src.services.document_permission import DocumentPermissionService


class DashboardService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = DashboardRepository(session)
        self.doc_repo = DocumentRepository(session)
        self.perm_svc = DocumentPermissionService(session)
        self.config_svc = SystemConfigService(session)

    async def get_stats(self, user: User) -> DashboardStatsResponse:
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = now - timedelta(days=7)
        month_start = now - timedelta(days=30)

        group_ids = await self.perm_svc.get_user_group_ids(user)

        try:
            quota_cfg = await self.config_svc.get_by_key("storage_quota")
            max_gb = int((quota_cfg.value or {}).get("max_gb", 100))
        except Exception:
            max_gb = 100

        used_bytes = await self.repo.get_storage_used_bytes(user.id)
        breakdown_data = await self.repo.get_storage_breakdown(user.id)
        processing_data = await self.repo.get_processing_stats(user.id)
        shared_with_me = await self.doc_repo.count_accessible(
            user.id, group_ids, shared_with_me=True
        )
        shared_by_me = await self.repo.get_shared_by_me_count(user.id)
        total_docs = await self.doc_repo.count_accessible(user.id, group_ids)
        added_today = await self.repo.count_owned_created_since(user.id, today_start)
        added_this_week = await self.repo.count_owned_created_since(user.id, week_start)
        added_this_month = await self.repo.count_owned_created_since(user.id, month_start)
        activity_data = await self.repo.get_activity_stats(user.id)

        return DashboardStatsResponse(
            storage=StorageStats(
                used_bytes=used_bytes,
                max_gb=max_gb,
                breakdown=StorageBreakdown(**breakdown_data),
            ),
            processing=ProcessingStats(**processing_data),
            shared=SharedStats(
                total=shared_with_me + shared_by_me,
                shared_by_me=shared_by_me,
                shared_with_me=shared_with_me,
            ),
            documents=DocumentCountStats(
                total=total_docs,
                added_today=added_today,
                added_this_week=added_this_week,
                added_this_month=added_this_month,
            ),
            activity=ActivityStats(**activity_data),
        )

    async def get_recent_files(self, user: User, limit: int = 6) -> list[dict]:
        group_ids = await self.perm_svc.get_user_group_ids(user)
        return await self.repo.get_recent_files(user.id, group_ids, limit)

    async def get_processing_data(self, user: User, limit: int = 6) -> list[dict]:
        return await self.repo.get_processing_data(user.id, limit)

    async def get_shared_files(self, user: User, limit: int = 6) -> list[dict]:
        group_ids = await self.perm_svc.get_user_group_ids(user)
        return await self.repo.get_shared_files(user.id, group_ids, limit)
