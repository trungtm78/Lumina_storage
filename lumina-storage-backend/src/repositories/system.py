from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.core import SystemConfig
from src.repositories.base import BaseRepository


class SystemConfigRepository(BaseRepository[SystemConfig]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(SystemConfig, session)

    async def get_by_key(self, key: str) -> SystemConfig | None:
        result = await self.session.execute(
            select(SystemConfig).where(SystemConfig.key == key)
        )
        return result.scalar_one_or_none()

    async def get_public_configs(self) -> list[SystemConfig]:
        result = await self.session.execute(
            select(SystemConfig).where(SystemConfig.is_public.is_(True))
        )
        return list(result.scalars().all())

    async def get_all_configs(self) -> list[SystemConfig]:
        result = await self.session.execute(select(SystemConfig))
        return list(result.scalars().all())
