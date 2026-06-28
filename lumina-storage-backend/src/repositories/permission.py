from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.user import MenuPermission


class MenuPermissionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_all(self) -> list[MenuPermission]:
        result = await self.session.execute(
            select(MenuPermission).order_by(MenuPermission.order_index)
        )
        return list(result.scalars().all())
