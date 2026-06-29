from functools import lru_cache

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    secret_key: str = "changeme"
    # Khóa Fernet riêng cho mã hóa data (credential). Trống → fallback secret_key
    # (kèm cảnh báo). Tách riêng để lộ JWT key không kéo theo lộ khóa mã hóa data.
    encryption_key: str = ""
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:5174" ]
    gotenberg_url: str = "http://localhost:3000"

    # Tunable policy values that previously lived in env vars now live as
    # constants in code:
    #   - JWT lifetimes        → src/core/security.py (ACCESS/REFRESH _EXPIRE_*)
    #   - Login rate limit     → src/api/v1/routes/auth.py (_LOGIN_RATE_LIMIT)
    #   - Upload size cap      → src/services/document.py (per-StorageConfig
    #                            JSONB key, default 100MB)

    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "lumina_driver_dev"
    db_user: str = "postgres"
    db_password: str = ""

    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str = ""

    # AI models (chat / embedding / vlm) are configured exclusively through the
    # admin UI -> AI Model Config. No env-var fallback by design — credentials
    # don't end up in shell history, and there's a single source of truth.
    # See src/services/ai_model_config_service.py:get_default_litellm_config.

    # Qdrant
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection: str = "document_chunks"
    qdrant_vector_size: int = 3072

    # Langfuse tracing (self-hosted)
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "http://localhost:3000"

    # Skills system (local apps uploaded via Apps menu)
    skills_dir: str = "skills"

    # Phase 4 T7 — rollout gate cho luồng chat hợp nhất. Default False = giữ luồng
    # hiện tại (route chỉ dùng stream_agent; citation lifecycle đã hợp nhất ở T6 qua
    # collector→citations_to_sources). Bật khi/ nếu wire thêm "simple strategy" qua
    # cùng pipeline citation, sau khi golden (tests/test_golden_chat_phase4.py) đạt.
    chat_unified_stream: bool = False

    # Lumina SSO
    lumina_sso_service_url: str = ""  # URL của lumina-sso-service, VD: http://localhost:3100

    # Microsoft Entra — Driver API token verification (OBO path from lumina-backend).
    # When set, get_current_user() accepts Microsoft access tokens whose aud matches
    # entra_driver_api_audience and verifies them offline via Entra JWKS.
    entra_tenant_id: str = ""
    entra_driver_api_audience: str = ""   # e.g. api://<driver-api-client-id>
    entra_jwks_cache_seconds: int = 3600

    @computed_field
    @property
    def database_url(self) -> str:
        return f"postgresql+asyncpg://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"

    @computed_field
    @property
    def redis_url(self) -> str:
        if self.redis_password:
            return f"redis://:{self.redis_password}@{self.redis_host}:{self.redis_port}"
        return f"redis://{self.redis_host}:{self.redis_port}"


# Env được coi là an toàn để CHỈ cảnh báo (không fail) khi secret yếu.
# Mọi env khác (production, staging, hoặc thiếu/không rõ) → strict fail-fast.
_SAFE_ENVS = {"development", "dev", "local", "test", "testing"}
# Substring placeholder phổ biến (đã normalize lower); chặn cả biến thể dài.
_PLACEHOLDER_MARKERS = ("changeme", "change-me", "change me", "your-secret-key",
                        "your_secret_key", "placeholder", "example", "secret-key-here")


def _is_weak_secret(secret: str) -> bool:
    """True nếu secret là placeholder, quá ngắn, hoặc entropy thấp."""
    s = (secret or "").strip()
    low = s.lower()
    if low in {"", "changeme", "secret", "changethis"}:
        return True
    if any(marker in low for marker in _PLACEHOLDER_MARKERS):
        return True
    if len(s) < 32:
        return True
    if len(set(s)) <= 4:  # vd "x"*40 — đủ dài nhưng entropy quá thấp
        return True
    return False


def validate_secrets(settings: Settings) -> None:
    """Fail-fast nếu SECRET_KEY yếu, TRỪ KHI env rõ ràng là dev/test (chỉ warn).

    Mặc định strict: production/staging/env-không-rõ với secret yếu → raise.
    Một SECRET_KEY placeholder/ngắn/low-entropy cho phép forge JWT (chiếm admin).
    """
    import logging

    # Cảnh báo MỘT LẦN ở startup (không spam hot path encrypt/decrypt).
    if not settings.encryption_key:
        logging.getLogger(__name__).warning(
            "[config] ENCRYPTION_KEY trống — credential sẽ mã hóa bằng SECRET_KEY. "
            "Đặt ENCRYPTION_KEY riêng cho production."
        )

    if not _is_weak_secret(settings.secret_key):
        return
    msg = (
        "SECRET_KEY là placeholder, quá ngắn (<32 ký tự), hoặc entropy thấp. "
        'Sinh khóa: python -c "import secrets; print(secrets.token_urlsafe(32))"'
    )
    env = (settings.app_env or "").strip().lower()
    if env not in _SAFE_ENVS:
        raise RuntimeError(msg)
    logging.getLogger(__name__).warning("[config] %s", msg)


@lru_cache
def get_settings() -> Settings:
    return Settings()
