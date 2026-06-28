"""Periodic cleanup of temporary skill files (filled docs + PDF previews).

Files with source_type='skill_temp' older than 24 hours are permanently deleted.
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text

from src.core.config import get_settings
from src.core.uow import uow_context
from src.services.storage import get_storage_backend

logger = logging.getLogger(__name__)


async def cleanup_skill_temp_task(ctx: dict) -> int:
    """Delete skill temp files older than 24 hours. Returns count deleted."""
    settings = get_settings()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    deleted = 0

    # Phase 3 T5: business boundary = uow_context với session_factory của ctx (testable).
    async with uow_context(ctx["session_factory"]) as uow:
        db = uow.session
        # Find old temp files
        result = await db.execute(
            text(
                "SELECT id, file_path, storage_config_id "
                "FROM documents_document "
                "WHERE source_type = 'skill_temp' "
                "AND created_at < :cutoff"
            ),
            {"cutoff": cutoff},
        )
        rows = result.fetchall()

        if not rows:
            return 0

        logger.info(f"[skill_cleanup] Found {len(rows)} temp files to delete")

        for row in rows:
            doc_id, file_path, storage_config_id = row[0], row[1], row[2]
            try:
                # Delete from storage
                from src.models.storage import StorageConfig
                storage_cfg = await db.get(StorageConfig, storage_config_id)
                if storage_cfg:
                    backend = get_storage_backend(storage_cfg)
                    try:
                        await backend.delete(file_path)
                    except Exception:
                        pass  # File might already be gone

                # Delete from DB
                await db.execute(
                    text("DELETE FROM documents_document WHERE id = :id"),
                    {"id": doc_id},
                )
                deleted += 1
            except Exception as exc:
                logger.warning(f"[skill_cleanup] Failed to delete {doc_id}: {exc}")

        # commit ở uow_context boundary khi thoát async with.
        logger.info(f"[skill_cleanup] Deleted {deleted}/{len(rows)} temp files")

    return deleted
