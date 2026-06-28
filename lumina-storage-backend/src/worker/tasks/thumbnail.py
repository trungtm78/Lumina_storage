import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import get_settings
from src.models.document import Document
from src.services.storage import get_storage_backend
from src.repositories.document import StorageConfigRepository
from src.services.thumbnail import generate_thumbnail, save_thumbnail


async def generate_thumbnail_task(ctx: dict, document_id: uuid.UUID) -> dict:
    session_factory = ctx["session_factory"]

    async with session_factory() as db:
        db: AsyncSession

        document = await db.get(Document, document_id)
        if not document:
            return {"error": "Document not found"}

        settings = get_settings()
        storage_repo = StorageConfigRepository(db)
        config = await storage_repo.get_by_id(document.storage_config_id)
        if not config:
            return {"error": "Storage config not found"}

        backend = get_storage_backend(config)

        try:
            file_bytes = await backend.read(document.file_path)
        except Exception as e:
            return {"error": f"Failed to read file: {e}"}

        thumbnail_bytes = await generate_thumbnail(
            file_bytes=file_bytes,
            mime_type=document.mime_type,
            gotenberg_url=settings.gotenberg_url,
        )

        if thumbnail_bytes is None:
            return {"skipped": True, "reason": "Unsupported format"}

        thumbnail_path = await save_thumbnail(thumbnail_bytes, backend)

        document.image_thumbnail = thumbnail_path
        await db.commit()

        return {"thumbnail_path": thumbnail_path}
