"""Phase 8 (W2.1) — ChatPermissionService: tách IDOR/ownership check khỏi chat_service.

PURE DB-touching (1 query). Raise NotFoundError → 404 (không lộ sự tồn tại của session
người khác). Tách khỏi god-service ChatService để tái dùng + test độc lập.
"""
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import NotFoundError
from src.models.chat import ChatSession


class ChatPermissionService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def assert_owned(self, session_id: uuid.UUID, user_id: uuid.UUID) -> ChatSession:
        """Trả session nếu thuộc user; raise NotFoundError (→404) nếu không tồn tại
        hoặc không thuộc user. Chống IDOR — không lộ sự tồn tại của session người khác."""
        session = await self._session.get(ChatSession, session_id)
        if session is None or session.user_id != user_id or session.deleted_at is not None:
            raise NotFoundError("Session not found")
        return session
