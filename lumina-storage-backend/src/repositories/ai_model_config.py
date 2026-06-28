import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.core import AIModelConfig
from src.repositories.base import BaseRepository


class AIModelConfigRepository(BaseRepository[AIModelConfig]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(AIModelConfig, session)

    async def list_by_purpose(self, purpose: str) -> list[AIModelConfig]:
        result = await self.session.execute(
            select(AIModelConfig)
            .where(AIModelConfig.purpose == purpose, AIModelConfig.is_active.is_(True))
            .order_by(AIModelConfig.name)
        )
        return list(result.scalars().all())

    async def list_all(self) -> list[AIModelConfig]:
        result = await self.session.execute(
            select(AIModelConfig).order_by(AIModelConfig.purpose, AIModelConfig.name)
        )
        return list(result.scalars().all())

    async def get_default_by_purpose(self, purpose: str) -> AIModelConfig | None:
        result = await self.session.execute(
            select(AIModelConfig).where(
                AIModelConfig.purpose == purpose,
                AIModelConfig.is_default.is_(True),
                AIModelConfig.is_active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def clear_default(self, purpose: str) -> None:
        await self.session.execute(
            update(AIModelConfig)
            .where(AIModelConfig.purpose == purpose, AIModelConfig.is_default.is_(True))
            .values(is_default=False)
        )
