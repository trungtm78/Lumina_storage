"""Phase 5b — selector: dựng chain provider từ ExtractionProviderConfig (routing theo
mime/ext + priority) + fallback chain (LocalHybrid LUÔN cuối). extract_with_fallback thử
lần lượt tới khi ra kết quả; log cost/latency (observability).

LocalHybrid xử lý RIÊNG (vlm-aware): config provider="local_hybrid" bỏ qua trong vòng lặp,
LocalHybrid dựng 1 lần ở cuối với vlm resolve đúng (excel→không vlm; non-excel→resolve vlm
như luồng ingest cũ). Provider ngoài dựng qua registry.from_config (api_key/base_url/options).
"""
import logging
import time

from sqlalchemy.ext.asyncio import AsyncSession

from src.extraction.base import ExtractionProvider
from src.extraction.local_hybrid import LocalHybridProvider
from src.extraction.registry import get_provider_class
from src.repositories.extraction_provider_config import ExtractionProviderConfigRepository
from src.services.text_extraction_service import PageResult

logger = logging.getLogger(__name__)

_EXCEL_EXTENSIONS = {".xlsx", ".xls", ".csv"}


def _applies(applies_to, mime_type: str, extension: str) -> bool:
    """Config khớp tài liệu? None/['*'] = mọi loại; else khớp mime hoặc extension."""
    if not applies_to or "*" in applies_to:
        return True
    return mime_type in applies_to or extension in applies_to


async def _build_local_hybrid(db, document, settings) -> LocalHybridProvider:
    """LocalHybrid vlm-aware (mirror luồng ingest cũ): excel→không vlm; non-excel→resolve vlm."""
    if document.extension in _EXCEL_EXTENSIONS:
        return LocalHybridProvider(gotenberg_url=settings.gotenberg_url)
    from src.services.ai_model_config_service import get_default_litellm_config

    vlm_cfg = await get_default_litellm_config(db, "vlm")
    return LocalHybridProvider(
        gotenberg_url=settings.gotenberg_url,
        vlm_model=vlm_cfg.model,
        vlm_kwargs={k: v for k, v in vlm_cfg.to_kwargs().items() if k != "model"},
    )


async def resolve_extraction_chain(
    db: AsyncSession, document, settings
) -> list[ExtractionProvider]:
    """Chain provider theo config (routing mime/ext + priority) + LocalHybrid fallback cuối."""
    chain: list[ExtractionProvider] = []
    configs = await ExtractionProviderConfigRepository(db).list_active()  # ORDER BY priority
    for cfg in configs:
        if cfg.provider == "local_hybrid":
            continue  # LocalHybrid xử lý riêng (vlm-aware) ở cuối — tránh trùng + thiếu vlm
        if not _applies(cfg.applies_to, document.mime_type, document.extension):
            continue
        cls = get_provider_class(cfg.provider)
        if cls is None:
            logger.warning("[extract] provider '%s' chưa đăng ký/cài SDK → bỏ", cfg.provider)
            continue
        try:
            chain.append(
                cls.from_config(
                    settings=settings, api_key=cfg.api_key, base_url=cfg.base_url, options=cfg.options
                )
            )
        except Exception as e:  # noqa: BLE001 — build lỗi (thiếu credential...) → bỏ, không chặn
            logger.warning("[extract] dựng provider '%s' lỗi → bỏ: %s", cfg.provider, e)
    chain.append(await _build_local_hybrid(db, document, settings))  # fallback an toàn cuối
    return chain


async def extract_with_fallback(
    chain: list[ExtractionProvider], file_bytes: bytes, mime_type: str, extension: str
) -> list[PageResult]:
    """Thử lần lượt provider trong chain; lỗi/rỗng → next; log latency. Tất cả lỗi → raise
    (ingest → failed; blue/green giữ bản cũ). Tất cả rỗng → trả [] (ingest → empty→failed)."""
    last_exc: Exception | None = None
    for provider in chain:
        t0 = time.perf_counter()
        try:
            pages = await provider.extract(file_bytes, mime_type, extension)
        except Exception as e:  # noqa: BLE001 — fallback sang provider kế
            last_exc = e
            logger.warning("[extract] provider=%s LỖI → fallback: %s", provider.name, e)
            continue
        dt = time.perf_counter() - t0
        if pages:
            logger.info("[extract] provider=%s OK %d page(s) %.2fs", provider.name, len(pages), dt)
            return pages
        logger.warning("[extract] provider=%s trả RỖNG %.2fs → fallback", provider.name, dt)
    if last_exc is not None:
        raise last_exc
    return []
