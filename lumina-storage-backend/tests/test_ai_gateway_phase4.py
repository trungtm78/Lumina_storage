"""Phase 4 T3 — AIGateway thin facade: delegate đúng underlying + truyền **overrides per-call.

Mock litellm/EmbeddingService (không gọi API thật).
"""
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.ai import AIGateway
from src.models.core import AIModelConfig

pytestmark = pytest.mark.asyncio


async def _add_config(db_session, purpose, *, extra=None):
    cfg = AIModelConfig(
        id=uuid.uuid4(),
        name=f"cfg-{purpose}-{uuid.uuid4().hex[:6]}",
        provider="openai",
        model_name="gpt-4o",
        purpose=purpose,
        api_key="sk-test",
        base_url=None,
        extra_config=extra,
        is_default=True,
        is_active=True,
    )
    db_session.add(cfg)
    await db_session.flush()
    return cfg


def _chunk(text):
    return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=text))])


class _AsyncIter:
    def __init__(self, items):
        self._items = list(items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._items:
            raise StopAsyncIteration
        return self._items.pop(0)


async def test_complete_passes_overrides(db_session):
    await _add_config(db_session, "chat", extra={"temperature": 0.7})
    gw = AIGateway(db_session)
    fake = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))])
    with patch("litellm.acompletion", new=AsyncMock(return_value=fake)) as m:
        await gw.complete([{"role": "user", "content": "hi"}], temperature=0, seed=42)
    kw = m.call_args.kwargs
    assert kw["stream"] is False
    assert kw["temperature"] == 0  # override THẮNG config 0.7
    assert kw["seed"] == 42


async def test_stream_yields_deltas(db_session):
    await _add_config(db_session, "chat")
    gw = AIGateway(db_session)

    async def fake_ac(**kwargs):
        assert kwargs["stream"] is True
        return _AsyncIter([_chunk("he"), _chunk("llo"), _chunk(None)])

    with patch("litellm.acompletion", new=fake_ac):
        out = [d async for d in gw.stream([{"role": "user", "content": "x"}])]
    assert out == ["he", "llo"]


async def test_vlm_complete_uses_vlm_purpose(db_session):
    # Chỉ có chat → fallback vlm→chat (T2), gateway.vlm_complete vẫn chạy.
    await _add_config(db_session, "chat")
    gw = AIGateway(db_session)
    fake = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="v"))])
    with patch("litellm.acompletion", new=AsyncMock(return_value=fake)) as m:
        await gw.vlm_complete([{"role": "user", "content": "img"}], max_tokens=8192)
    assert m.call_args.kwargs["max_tokens"] == 8192


async def test_embed_delegates_to_embedding_service(db_session):
    gw = AIGateway(db_session)
    fake_svc = SimpleNamespace(embed_texts=AsyncMock(return_value=[[0.1, 0.2]]))
    with patch(
        "src.ai.gateway.EmbeddingService.from_db_default",
        new=AsyncMock(return_value=fake_svc),
    ):
        out = await gw.embed(["hello"])
    assert out == [[0.1, 0.2]]
    fake_svc.embed_texts.assert_awaited_once_with(["hello"])


async def test_langchain_model_builds_with_config(db_session):
    await _add_config(db_session, "chat")
    gw = AIGateway(db_session)
    model = await gw.langchain_model(streaming=True)
    # ChatLiteLLM giữ model string đã prefix provider.
    assert getattr(model, "model", "").endswith("gpt-4o")


async def test_langchain_model_preserves_max_tokens(db_session):
    # /codex T3 P1: generation params từ config phải xuống ChatLiteLLM (trước đây bị bỏ).
    await _add_config(db_session, "chat", extra={"max_tokens": 5000, "temperature": 0.1})
    gw = AIGateway(db_session)
    model = await gw.langchain_model()
    assert getattr(model, "max_tokens", None) == 5000


async def test_complete_with_explicit_stream_override_no_crash(db_session):
    # /codex T3 P1: caller truyền stream qua overrides KHÔNG gây duplicate-kwarg crash.
    await _add_config(db_session, "chat", extra={"stream": True})  # config cũng có 'stream'
    gw = AIGateway(db_session)
    fake = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))])
    with patch("litellm.acompletion", new=AsyncMock(return_value=fake)) as m:
        await gw.complete([{"role": "user", "content": "hi"}], stream=True)
    # method semantics thắng: complete LUÔN stream=False.
    assert m.call_args.kwargs["stream"] is False
