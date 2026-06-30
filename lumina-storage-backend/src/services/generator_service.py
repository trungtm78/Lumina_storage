"""Service bọc GeneratorSession + GeneratorSessionVersion repository.

Phase 6: route KHÔNG truy cập repository trực tiếp → đi qua service này. Mỗi method
delegate 1-1 sang repo tương ứng; KHÔNG commit (boundary ở get_db). Business-logic nặng
(patch DOCX, sinh PDF, AI-revise) vẫn ở route — sẽ trích dần ở Phase 7.
"""
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.models.generator import GeneratorSession, GeneratorSessionVersion
from src.repositories.generator import (
    GeneratorSessionRepository,
    GeneratorSessionVersionRepository,
)


class GeneratorService:
    def __init__(self, session: AsyncSession) -> None:
        self._sessions = GeneratorSessionRepository(session)
        self._versions = GeneratorSessionVersionRepository(session)

    # ── Session ──────────────────────────────────────────────────────────────
    async def create_session(self, data: dict) -> GeneratorSession:
        return await self._sessions.create(data)

    async def get_session_for_user(
        self, session_id: uuid.UUID, user_id: uuid.UUID
    ) -> GeneratorSession | None:
        return await self._sessions.get_by_id_for_user(session_id, user_id)

    async def update_session(
        self, session_id: uuid.UUID, data: dict
    ) -> GeneratorSession | None:
        return await self._sessions.update(session_id, data)

    async def delete_session(self, session_id: uuid.UUID) -> bool:
        return await self._sessions.delete(session_id)

    async def list_sessions_for_user(
        self,
        user_id: uuid.UUID,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[GeneratorSession], int]:
        return await self._sessions.list_for_user(
            user_id=user_id, status=status, limit=limit, offset=offset
        )

    async def count_drafts_by_template(self, template_id: uuid.UUID) -> int:
        return await self._sessions.count_draft_by_template(template_id)

    # ── Version ──────────────────────────────────────────────────────────────
    async def next_version_no(self, session_id: uuid.UUID) -> int:
        return await self._versions.next_version_no(session_id)

    async def create_version(self, data: dict) -> GeneratorSessionVersion:
        return await self._versions.create(data)

    async def get_version_for_session(
        self, version_id: uuid.UUID, session_id: uuid.UUID
    ) -> GeneratorSessionVersion | None:
        return await self._versions.get_by_id_for_session(version_id, session_id)

    async def update_version(
        self, version_id: uuid.UUID, data: dict
    ) -> GeneratorSessionVersion | None:
        return await self._versions.update(version_id, data)

    async def list_versions_for_session(
        self, session_id: uuid.UUID, limit: int = 50, offset: int = 0
    ) -> tuple[list[GeneratorSessionVersion], int]:
        return await self._versions.list_for_session(session_id, limit=limit, offset=offset)

    async def delete_version(self, version_id: uuid.UUID) -> bool:
        return await self._versions.delete(version_id)
