"""Streaming LLM completion via LiteLLM.

The model + credentials come from the admin-configured AIModelConfig row in
the database (purpose='chat'), not from environment variables. There is no
env fallback by design.
"""

from collections.abc import AsyncIterator

import litellm
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.ai_model_config_service import (
    LiteLLMConfig,
    get_default_litellm_config,
)


class LLMService:
    def __init__(self, config: LiteLLMConfig) -> None:
        self._config = config

    @classmethod
    async def from_db_default(cls, db: AsyncSession) -> "LLMService":
        """Build LLMService from the admin-configured default chat model.

        Raises AIModelConfigNotFoundError if admin hasn't added a chat model.
        """
        cfg = await get_default_litellm_config(db, "chat")
        return cls(cfg)

    async def stream_completion(self, messages: list[dict]) -> AsyncIterator[str]:
        # Phase 4 (C1): stream=True qua overrides để tránh collision nếu extra_config có 'stream'.
        response = await litellm.acompletion(
            messages=messages,
            **self._config.to_kwargs(stream=True),
        )
        async for chunk in response:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
