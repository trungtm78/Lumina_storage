import asyncio
import logging
from typing import TYPE_CHECKING

import litellm

from src.services.ai_model_config_service import (
    LiteLLMConfig,
    get_default_litellm_config,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_BATCH_SIZE = 16          # số texts mỗi request
_MAX_CONCURRENT = 1      # số batch chạy song song tối đa (tránh rate limit)
_MAX_RETRIES = 5
_RETRY_BASE_DELAY = 15.0  # seconds


class EmbeddingService:
    """Embedding wrapper. Construct via from_db_default — there is no env fallback."""

    def __init__(self, config: LiteLLMConfig) -> None:
        self._config = config
        self.model = config.model
        self.api_key = config.api_key
        self.api_base = config.api_base
        self.api_version = config.api_version

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

    # Table số có token density ~0.54/char, dùng 12000 chars (~6480 tokens) để an toàn
    _MAX_CHARS_PER_TEXT = 12000

    async def _embed_single_request(self, texts: list[str]) -> list[list[float]]:
        """1 request với retry backoff cho RateLimitError. Truncate nếu text quá dài."""
        truncated = [t[: self._MAX_CHARS_PER_TEXT] if len(t) > self._MAX_CHARS_PER_TEXT else t for t in texts]
        if any(len(t) < len(o) for t, o in zip(truncated, texts)):
            logger.warning("[embedding] truncated %d text(s) to %d chars", sum(1 for t, o in zip(truncated, texts) if len(t) < len(o)), self._MAX_CHARS_PER_TEXT)
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
