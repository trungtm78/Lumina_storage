from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.core.config import get_settings
from src.services.vector_service import VectorService


async def startup(ctx: dict) -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    ctx["session_factory"] = async_sessionmaker(engine, expire_on_commit=False)
    ctx["engine"] = engine

    # EmbeddingService is built per-task via EmbeddingService.from_db_default(db)
    # because the active model can change at runtime through the AI Model Config
    # admin UI — caching one instance at worker startup would pin stale config.

    vector_svc = VectorService(settings)
    await vector_svc.ensure_collection()
    ctx["vector_service"] = vector_svc


async def shutdown(ctx: dict) -> None:
    await ctx["engine"].dispose()
