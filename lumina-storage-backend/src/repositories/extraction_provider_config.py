"""Phase 5b — repo ExtractionProviderConfig (mirror AIModelConfigRepository)."""
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.extraction import ExtractionProviderConfig
from src.repositories.base import BaseRepository


class ExtractionProviderConfigRepository(BaseRepository[ExtractionProviderConfig]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(ExtractionProviderConfig, session)

    async def list_all(self) -> list[ExtractionProviderConfig]:
        result = await self.session.execute(
            select(ExtractionProviderConfig).order_by(
                ExtractionProviderConfig.priority, ExtractionProviderConfig.name
            )
        )
        return list(result.scalars().all())

    async def list_active(self) -> list[ExtractionProviderConfig]:
        """Provider đang bật, sắp theo priority (nhỏ = ưu tiên) — selector dùng routing."""
        result = await self.session.execute(
            select(ExtractionProviderConfig)
            .where(ExtractionProviderConfig.is_active.is_(True))
            .order_by(ExtractionProviderConfig.priority, ExtractionProviderConfig.name)
        )
        return list(result.scalars().all())

    async def get_default(self) -> ExtractionProviderConfig | None:
        result = await self.session.execute(
            select(ExtractionProviderConfig).where(
                ExtractionProviderConfig.is_default.is_(True),
                ExtractionProviderConfig.is_active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def clear_default(self) -> None:
        await self.session.execute(
            update(ExtractionProviderConfig)
            .where(ExtractionProviderConfig.is_default.is_(True))
            .values(is_default=False)
        )
