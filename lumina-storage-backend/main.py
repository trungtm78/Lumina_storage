import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from pathlib import Path

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# Suppress LiteLLM's noisy provider-detection warnings (e.g. missing Vertex AI ADC)
logging.getLogger("LiteLLM").setLevel(logging.CRITICAL)
logging.getLogger("litellm").setLevel(logging.CRITICAL)

from src.api.v1.routes import auth, health, users
from src.api.v1.routes import tasks
from src.api.v1.routes import documents, chat
from src.api.v1.routes import folders, google_drive, storage, system
from src.api.v1.routes import ai_model_config
from src.api.v1.routes import groups
from src.api.v1.routes import templates
from src.api.v1.routes import generator
from src.api.v1.routes import ops
from src.api.v1.routes import review
from src.api.v1.routes import candidate_evaluation
from src.api.v1.routes import dashboard

from src.api.v1.routes import upload
from src.core.config import get_settings
from src.core.exceptions import register_exception_handlers
from src.services.skill_service import SkillService
from src.services.vector_service import VectorService

# Singleton services (initialized in lifespan)
_skill_service: SkillService | None = None


def get_skill_service() -> SkillService:
    """LEGACY getter (startup-only fallback). Route mới nên dùng
    src.api.providers.get_skill_service (đọc app.state). Cùng instance được gán
    ở lifespan nên không split-brain; getter này sẽ bỏ dần khi route migrate."""
    if _skill_service is None:
        raise RuntimeError("SkillService not initialized. App not started?")
    return _skill_service


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    global _skill_service

    settings = get_settings()
    app.state.arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    await VectorService(settings).ensure_collection()

    # Initialize singleton services (cũng đặt lên app.state cho DI providers)
    _skill_service = SkillService(settings)
    app.state.skill_service = _skill_service

    # Enable LiteLLM → Langfuse tracing for all litellm.acompletion calls
    # (covers generator endpoints; chat/agent flows use LangChain callbacks separately)
    if settings.langfuse_public_key and settings.langfuse_secret_key:
        import os
        os.environ.setdefault("LANGFUSE_PUBLIC_KEY", settings.langfuse_public_key)
        os.environ.setdefault("LANGFUSE_SECRET_KEY", settings.langfuse_secret_key)
        os.environ.setdefault("LANGFUSE_HOST", settings.langfuse_host)

        import litellm as _litellm
        _litellm.success_callback = ["langfuse"]
        _litellm.failure_callback = ["langfuse"]
        logging.getLogger(__name__).info("Langfuse tracing enabled via LiteLLM callbacks")

    yield
    await app.state.arq_pool.aclose()


def create_app() -> FastAPI:
    from src.core.logging import configure_logging
    configure_logging()

    app = FastAPI(title="Lumina Driver Backend", version="1.0.0", lifespan=lifespan)

    settings = get_settings()

    # Fail-fast nếu production dùng SECRET_KEY yếu/placeholder.
    from src.core.config import validate_secrets
    validate_secrets(settings)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition", "X-Request-ID"],
    )

    # Correlation-ID: gắn X-Request-ID cho mọi request (echo nếu client gửi UUID
    # hợp lệ) + đẩy vào contextvar để structlog log ra request_id.
    from asgi_correlation_id import CorrelationIdMiddleware
    app.add_middleware(CorrelationIdMiddleware, header_name="X-Request-ID")

    # Wire the slowapi limiter declared in the auth router so its decorators take effect
    app.state.limiter = auth.limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    register_exception_handlers(app)

    app.include_router(health.router, prefix="/api/v1")
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(users.router, prefix="/api/v1")
    app.include_router(tasks.router, prefix="/api/v1")
    app.include_router(documents.router, prefix="/api/v1")
    app.include_router(chat.router, prefix="/api/v1")
    app.include_router(storage.router, prefix="/api/v1")
    app.include_router(folders.router, prefix="/api/v1")
    app.include_router(google_drive.router, prefix="/api/v1")
    app.include_router(system.router, prefix="/api/v1")
    app.include_router(ai_model_config.router, prefix="/api/v1")
    app.include_router(groups.router, prefix="/api/v1")
    app.include_router(templates.router, prefix="/api/v1")
    app.include_router(generator.router, prefix="/api/v1")
    app.include_router(ops.router, prefix="/api/v1")
    app.include_router(review.router, prefix="/api/v1")
    app.include_router(candidate_evaluation.router, prefix="/api/v1")
    app.include_router(dashboard.router, prefix="/api/v1")

    app.include_router(upload.router, prefix="/api/v1")

    # Mount static files for uploads
    uploads_dir = Path("uploads")
    uploads_dir.mkdir(exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

    return app


app = create_app()
