import asyncio
import logging
from typing import TYPE_CHECKING

import litellm

from src.shared.ai_model_config_service import (
    LiteLLMConfig,
    get_default_litellm_config,
)
from src.shared.tokenizer import truncate_to_token_limit

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_BATCH_SIZE = 16          # số texts mỗi request
_MAX_CONCURRENT = 3      # Phase 5a T7: 1→3 batch song song (giữ rate-limit retry bên dưới)
_MAX_RETRIES = 5
_RETRY_BASE_DELAY = 15.0  # seconds
# Phase 5a T6: ngưỡng TOKEN (thay truncate 12000 KÝ TỰ mù). Cao mặc định để chunk thường
# (~1800 char) KHÔNG bị cắt; override per-model qua AIModelConfig extra_config embed_max_tokens.
_DEFAULT_MAX_TOKENS_PER_TEXT = 8000


class EmbeddingService:
    """Embedding wrapper. Construct via from_db_default — there is no env fallback."""

    def __init__(self, config: LiteLLMConfig) -> None:
        self._config = config
        self.model = config.model
        self.api_key = config.api_key
        self.api_base = config.api_base
        self.api_version = config.api_version
        # T6: ngưỡng token. config.embed_max_tokens đã validate (số nguyên dương) ở
        # get_default_litellm_config; None/không hợp lệ → default. (codex P2: tránh crash/0.)
        emt = getattr(config, "embed_max_tokens", None)
        self._max_tokens = emt if isinstance(emt, int) and emt > 0 else _DEFAULT_MAX_TOKENS_PER_TEXT

    @classmethod
    async def from_db_default(cls, db: "AsyncSession") -> "EmbeddingService":
        """Build EmbeddingService from the admin-configured default embedding model.

        Raises AIModelConfigNotFoundError if admin hasn't added an embedding
        model yet. Callers should surface that to the user clearly — there's
        no env-var fallback to silently substitute.
        """
        cfg = await get_default_litellm_config(db, "embedding")
        return cls(cfg)

    async def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed 1 batch với retry. Tự halve batch nếu ContextWindowExceeded."""
        if len(texts) > 1:
            try:
                return await self._embed_single_request(texts)
            except litellm.ContextWindowExceededError:
                mid = len(texts) // 2
                logger.warning("[embedding] ContextWindowExceeded, splitting batch %d → %d+%d", len(texts), mid, len(texts) - mid)
                left = await self._embed_batch(texts[:mid])
                right = await self._embed_batch(texts[mid:])
                return left + right
        else:
            return await self._embed_single_request(texts)

    async def _embed_single_request(self, texts: list[str]) -> list[list[float]]:
        """1 request với retry backoff cho RateLimitError. Phase 5a T6: cắt theo TOKEN thật
        (truncate_to_token_limit) thay truncate ký tự mù — chunk thường (~1800 char) không bị
        cắt; chỉ text vượt _max_tokens (vd bảng dày) mới cắt, đúng theo token model."""
        truncated = [truncate_to_token_limit(t, self._max_tokens, model=self.model) for t in texts]
        if any(len(t) < len(o) for t, o in zip(truncated, texts)):
            logger.warning("[embedding] truncated %d text(s) to %d tokens", sum(1 for t, o in zip(truncated, texts) if len(t) < len(o)), self._max_tokens)
        delay = _RETRY_BASE_DELAY
        for attempt in range(_MAX_RETRIES):
            try:
                response = await litellm.aembedding(
                    model=self.model,
                    input=truncated,
                    api_key=self.api_key,
                    api_base=self.api_base,
                    api_version=self.api_version,
                )
                return [item["embedding"] for item in response.data]
            except litellm.RateLimitError:
                if attempt == _MAX_RETRIES - 1:
                    raise
                logger.warning("[embedding] RateLimitError, retry %d/%d after %.0fs", attempt + 1, _MAX_RETRIES, delay)
                await asyncio.sleep(delay)
                delay *= 2

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        batches = [texts[i : i + _BATCH_SIZE] for i in range(0, len(texts), _BATCH_SIZE)]
        total = len(texts)
        results: list[list[float] | None] = [None] * len(batches)
        semaphore = asyncio.Semaphore(_MAX_CONCURRENT)

        async def _embed_one(idx: int, batch: list[str]) -> None:
            start = idx * _BATCH_SIZE + 1
            logger.info("[embedding] batch %d-%d / %d", start, start + len(batch) - 1, total)
            async with semaphore:
                results[idx] = await self._embed_batch(batch)

        await asyncio.gather(*[_embed_one(i, b) for i, b in enumerate(batches)])

        return [vec for batch_result in results for vec in batch_result]

    async def embed_query(self, text: str) -> list[float]:
        return (await self.embed_texts([text]))[0]
