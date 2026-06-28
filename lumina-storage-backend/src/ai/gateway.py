"""AIGateway — thin facade cho mọi lời gọi LLM/Embedding/VLM (Phase 4 T3).

Mỗi method tự resolve `LiteLLMConfig` theo purpose (chat/embedding/vlm) qua
`get_default_litellm_config`, rồi delegate sang litellm / EmbeddingService / build_model.
Nhận `**overrides` per-call (C1 — caller giữ temperature/seed/stream...). Tracing hook
gắn ở MỘT chỗ (`_trace`) — T4 nối Langfuse async.

KHÔNG nhồi logic (M3): không tự retry/batch/truncate — embedding giữ ở EmbeddingService.
"""
from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from src.services.ai_model_config_service import get_default_litellm_config
from src.services.embedding_service import EmbeddingService


class AIGateway:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── tracing hook (T4 nối Langfuse) ───────────────────────────────────────
    def _trace(self, op: str, **meta: Any) -> None:
        """Điểm gắn tracing DUY NHẤT. T3: no-op; T4: emit Langfuse event (async flush)."""
        return None

    # ── LLM ──────────────────────────────────────────────────────────────────
    async def stream(
        self, messages: list[dict], *, purpose: str = "chat", **overrides: Any
    ) -> AsyncIterator[str]:
        """Stream completion → yield text delta. purpose mặc định 'chat'."""
        import litellm

        cfg = await get_default_litellm_config(self._db, purpose)
        self._trace("llm.stream", purpose=purpose, model=cfg.model)
        # /codex T3 P1: FORCE stream=True SAU to_kwargs (tránh TypeError multiple-values
        # nếu caller/extra_config cũng có 'stream'); semantics method luôn thắng.
        kwargs = cfg.to_kwargs(**overrides)
        kwargs["stream"] = True
        response = await litellm.acompletion(messages=messages, **kwargs)
        async for chunk in response:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    async def complete(
        self, messages: list[dict], *, purpose: str = "chat", **overrides: Any
    ):
        """Non-stream completion → trả response litellm (caller đọc choices)."""
        import litellm

        cfg = await get_default_litellm_config(self._db, purpose)
        self._trace("llm.complete", purpose=purpose, model=cfg.model)
        kwargs = cfg.to_kwargs(**overrides)
        kwargs["stream"] = False  # /codex T3 P1: force semantics, tránh duplicate-kwarg
        return await litellm.acompletion(messages=messages, **kwargs)

    # ── Embedding ─────────────────────────────────────────────────────────────
    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed — delegate EmbeddingService (giữ retry/batch/halving của nó)."""
        self._trace("embedding.embed", count=len(texts))
        svc = await EmbeddingService.from_db_default(self._db)
        return await svc.embed_texts(texts)

    # ── VLM ───────────────────────────────────────────────────────────────────
    async def vlm_complete(self, messages: list[dict], **overrides: Any):
        """VLM completion (purpose 'vlm', fallback 'chat'). max_tokens default ở lớp
        tiêu thụ text_extraction — caller VLM khác nên truyền max_tokens qua overrides."""
        import litellm

        cfg = await get_default_litellm_config(self._db, "vlm")
        self._trace("vlm.complete", model=cfg.model)
        return await litellm.acompletion(
            messages=messages, **cfg.to_kwargs(**overrides)
        )

    # ── LangChain / LangGraph model (cho chat simple + agent) ─────────────────
    async def langchain_model(self, *, streaming: bool = True, **overrides: Any):
        """ChatLiteLLM cho luồng chat simple (LCEL). purpose 'chat'."""
        from langchain_community.chat_models import ChatLiteLLM

        cfg = await get_default_litellm_config(self._db, "chat")
        # /codex T3 P1: giữ generation params (max_tokens/temperature/extra) — trước đây bị
        # bỏ. ChatLiteLLM dùng 'streaming' (không 'stream'). api_version cho ChatLiteLLM
        # giữ như _ensure_llm hiện tại (không truyền — Azure simple-chat dùng model string;
        # pre-existing, T7 xử lý nếu cần).
        kwargs: dict = {"model": cfg.model, "streaming": streaming}
        if cfg.api_key:
            kwargs["api_key"] = cfg.api_key
        if cfg.api_base:
            kwargs["api_base"] = cfg.api_base
        if cfg.max_tokens is not None:
            kwargs["max_tokens"] = cfg.max_tokens
        if cfg.temperature is not None:
            kwargs["temperature"] = cfg.temperature
        kwargs.update(cfg.extra)
        kwargs.update(overrides)
        self._trace("llm.langchain_model", model=cfg.model)
        return ChatLiteLLM(**kwargs)

    async def langgraph_model(self, **overrides: Any):
        """LangChain chat model cho agent (LangGraph build_model). purpose 'chat'."""
        from src.services.agent import build_model

        cfg = await get_default_litellm_config(self._db, "chat")
        self._trace("llm.langgraph_model", model=cfg.model)
        return build_model(
            cfg.model,
            api_key=cfg.api_key,
            api_base=cfg.api_base,
            api_version=cfg.api_version,
            **overrides,
        )
