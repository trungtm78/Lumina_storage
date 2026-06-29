"""Phase 5a Task 4 — embedding cắt theo TOKEN thật (T6) + concurrency 1→3 (T7).

T6: bỏ truncate 12000 KÝ TỰ mù → truncate_to_token_limit (tokenizer); ngưỡng config
(_MAX_TOKENS_PER_TEXT default cao, override qua AIModelConfig extra_config embed_max_tokens).
T7: _MAX_CONCURRENT 1→3, giữ rate-limit retry.
"""
import asyncio
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from src.services.ai_model_config_service import LiteLLMConfig
from src.services.embedding_service import EmbeddingService
from src.services.tokenizer import count_tokens

pytestmark = pytest.mark.asyncio


def _resp(input_):
    return SimpleNamespace(data=[{"embedding": [0.0]} for _ in input_])


async def test_long_text_under_token_limit_not_truncated():
    # 13000 ký tự (> ngưỡng CŨ 12000 char) nhưng limit token rất cao → KHÔNG cắt (chứng minh
    # token-based, không char-based mù).
    svc = EmbeddingService(LiteLLMConfig(model="m", embed_max_tokens=1_000_000))
    text = "a" * 13000
    captured = {}

    async def fake_aemb(model, input, **kw):
        captured["input"] = input
        return _resp(input)

    with patch("litellm.aembedding", new=fake_aemb):
        await svc.embed_texts([text])
    assert captured["input"][0] == text  # nguyên vẹn, không cắt 12000 ký tự


async def test_text_over_token_limit_truncated_by_token():
    svc = EmbeddingService(LiteLLMConfig(model="m", embed_max_tokens=5))
    text = " ".join(f"word{i}" for i in range(50))  # > 5 token
    captured = {}

    async def fake_aemb(model, input, **kw):
        captured["input"] = input
        return _resp(input)

    with patch("litellm.aembedding", new=fake_aemb):
        await svc.embed_texts([text])
    assert count_tokens(captured["input"][0]) <= 5  # cắt đúng theo token
    assert len(captured["input"][0]) < len(text)


@pytest.mark.parametrize("bad", [None, 0, -5])
async def test_invalid_embed_max_tokens_falls_back_to_default(bad):
    # codex P2: None/0/âm → default (không crash, không cắt input về "").
    svc = EmbeddingService(LiteLLMConfig(model="m", embed_max_tokens=bad))
    assert svc._max_tokens == 8000


async def test_get_default_extracts_embed_max_tokens_no_leak(db_session):
    import uuid

    from src.models.core import AIModelConfig
    from src.services.ai_model_config_service import get_default_litellm_config

    db_session.add(AIModelConfig(
        id=uuid.uuid4(), name="e", provider="openai", model_name="text-embedding-3-large",
        purpose="embedding", api_key="k", base_url=None,
        extra_config={"embed_max_tokens": 4096, "top_p": 0.5}, is_default=True, is_active=True,
    ))
    await db_session.flush()
    cfg = await get_default_litellm_config(db_session, "embedding")
    assert cfg.embed_max_tokens == 4096
    # codex P2: embed_max_tokens KHÔNG lọt vào extra/to_kwargs (tránh unknown kwarg provider).
    assert "embed_max_tokens" not in cfg.extra
    assert "embed_max_tokens" not in cfg.to_kwargs()
    assert cfg.extra.get("top_p") == 0.5  # param phụ vẫn giữ


async def test_embed_concurrency_capped_at_3():
    svc = EmbeddingService(LiteLLMConfig(model="m"))
    peak = 0
    cur = 0

    async def fake_single(texts):
        nonlocal peak, cur
        cur += 1
        peak = max(peak, cur)
        await asyncio.sleep(0.03)
        cur -= 1
        return [[0.0] for _ in texts]

    svc._embed_single_request = fake_single
    await svc.embed_texts(["x"] * (16 * 4))  # 4 batch (batch=16) → semaphore cho phép tối đa 3
    assert peak == 3
