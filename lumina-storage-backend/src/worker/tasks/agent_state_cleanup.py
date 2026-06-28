"""Periodic cleanup of agent skill_state on chat messages.

Goal: stop the JSONB column from bloating indefinitely. We strip the
`skill_state` payload from `skill_result` for messages whose chat session has
been idle for 30+ days. We keep the rest of `skill_result` (rendered_document_id,
preview_pdf_id, applied_count) because the UI references those when rendering
old conversations.
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from src.core.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


AGENT_STATE_TTL_DAYS = 30


async def cleanup_agent_state_task(ctx: dict) -> int:
    """Strip skill_state from old chat messages. Returns rows updated."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=AGENT_STATE_TTL_DAYS)

    async with AsyncSessionLocal() as db:
        # We mutate via SQL because going through the ORM would load each JSONB
        # blob into Python — defeating the point of cleaning them up.
        result = await db.execute(
            text(
                """
                UPDATE chat_chatmessage
                   SET skill_result = skill_result - 'skill_state'
                 WHERE skill_result ? 'skill_state'
                   AND session_id IN (
                       SELECT s.id FROM chat_chatsession s
                       WHERE s.updated_at < :cutoff
                   )
                """
            ),
            {"cutoff": cutoff},
        )
        await db.commit()
        rows = result.rowcount or 0
        logger.info("[agent_state_cleanup] stripped skill_state from %d messages older than %d days", rows, AGENT_STATE_TTL_DAYS)
        return rows
