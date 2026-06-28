import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.integrations import GoogleDriveImport
from src.repositories.base import BaseRepository


class GoogleDriveImportRepository(BaseRepository[GoogleDriveImport]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(GoogleDriveImport, session)

    async def get_by_user(self, user_id: uuid.UUID) -> list[GoogleDriveImport]:
        result = await self.session.execute(
            select(GoogleDriveImport)
            .where(GoogleDriveImport.user_id == user_id)
            .order_by(GoogleDriveImport.created_at.desc())
        )
        return list(result.scalars().all())
