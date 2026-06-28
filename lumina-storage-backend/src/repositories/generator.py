import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.generator import GeneratorSession, GeneratorSessionVersion
from src.repositories.base import BaseRepository


class GeneratorSessionRepository(BaseRepository[GeneratorSession]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(GeneratorSession, session)

    async def get_by_id_for_user(self, session_id: uuid.UUID, user_id: uuid.UUID) -> GeneratorSession | None:
        result = await self.session.execute(
            select(GeneratorSession).where(
                GeneratorSession.id == session_id,
                GeneratorSession.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def count_draft_by_template(self, template_id: uuid.UUID) -> int:
        result = await self.session.execute(
            select(func.count()).select_from(GeneratorSession).where(
                GeneratorSession.template_id == template_id,
                GeneratorSession.status == "draft",
            )
        )
        return result.scalar_one()

    async def soft_delete_drafts_by_template(self, template_id: uuid.UUID) -> int:
        from datetime import datetime, timezone
        from sqlalchemy import update
        result = await self.session.execute(
            update(GeneratorSession)
            .where(
                GeneratorSession.template_id == template_id,
                GeneratorSession.status == "draft",
            )
            .values(
                status="cancelled",
                updated_at=datetime.now(timezone.utc),
            )
            .returning(GeneratorSession.id)
        )
        await self.session.flush()
        return len(result.all())

    async def list_for_user(
        self,
        user_id: uuid.UUID,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[GeneratorSession], int]:
        query = select(GeneratorSession).where(GeneratorSession.user_id == user_id)
        count_query = select(func.count()).select_from(GeneratorSession).where(GeneratorSession.user_id == user_id)

        if status is not None:
            query = query.where(GeneratorSession.status == status)
            count_query = count_query.where(GeneratorSession.status == status)

        query = query.order_by(GeneratorSession.updated_at.desc()).limit(limit).offset(offset)

        result = await self.session.execute(query)
        count_result = await self.session.execute(count_query)

        items = list(result.scalars().all())
        total = count_result.scalar_one()
        return items, total


class GeneratorSessionVersionRepository(BaseRepository[GeneratorSessionVersion]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(GeneratorSessionVersion, session)

    async def next_version_no(self, session_id: uuid.UUID) -> int:
        result = await self.session.execute(
            select(func.coalesce(func.max(GeneratorSessionVersion.version_no), 0)).where(
                GeneratorSessionVersion.session_id == session_id
            )
        )
        return int(result.scalar_one()) + 1

    async def get_by_id_for_session(
        self, version_id: uuid.UUID, session_id: uuid.UUID
    ) -> GeneratorSessionVersion | None:
        result = await self.session.execute(
            select(GeneratorSessionVersion).where(
                GeneratorSessionVersion.id == version_id,
                GeneratorSessionVersion.session_id == session_id,
            )
        )
        return result.scalar_one_or_none()

    async def list_for_session(
        self, session_id: uuid.UUID, limit: int = 50, offset: int = 0
    ) -> tuple[list[GeneratorSessionVersion], int]:
        query = (
            select(GeneratorSessionVersion)
            .where(GeneratorSessionVersion.session_id == session_id)
            .order_by(GeneratorSessionVersion.version_no.desc())
            .limit(limit)
            .offset(offset)
        )
        count_query = (
            select(func.count())
            .select_from(GeneratorSessionVersion)
            .where(GeneratorSessionVersion.session_id == session_id)
        )
        result = await self.session.execute(query)
        count_result = await self.session.execute(count_query)
        return list(result.scalars().all()), count_result.scalar_one()
