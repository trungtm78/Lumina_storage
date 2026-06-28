"""Phase 4 T1 — LiteLLMConfig model hóa (max_tokens/temperature/extra + to_kwargs overrides)
+ get_default_litellm_config merge extra_config + purpose 'vlm' fallback 'chat' NO-RAISE
+ VALID_PURPOSES thêm 'vlm'.
"""
import uuid

import pytest

from src.models.core import AIModelConfig
from src.schemas.ai_model_config import VALID_PURPOSES
from src.services.ai_model_config_service import (
    LiteLLMConfig,
    get_default_litellm_config,
)


# ── to_kwargs (pure) ─────────────────────────────────────────────────────────

def test_to_kwargs_includes_max_tokens_temperature_extra():
    cfg = LiteLLMConfig(
        model="gpt-4o",
        max_tokens=8192,
        temperature=0.3,
        extra={"top_p": 0.9, "seed": 7},
    )
    kw = cfg.to_kwargs()
    assert kw["model"] == "gpt-4o"
    assert kw["max_tokens"] == 8192
    assert kw["temperature"] == 0.3
    assert kw["top_p"] == 0.9
    assert kw["seed"] == 7


def test_to_kwargs_omits_none_fields_backward_compat():
    cfg = LiteLLMConfig(model="gpt-4o")
    kw = cfg.to_kwargs()
    assert kw == {"model": "gpt-4o"}
    assert "max_tokens" not in kw and "temperature" not in kw


def test_to_kwargs_per_call_overrides_win():
    # C1: review.py truyền temperature=0, seed=42, stream=False phải thắng config.
    cfg = LiteLLMConfig(model="gpt-4o", temperature=0.7, extra={"seed": 1})
    kw = cfg.to_kwargs(temperature=0, seed=42, stream=False)
    assert kw["temperature"] == 0
    assert kw["seed"] == 42
    assert kw["stream"] is False


# ── get_default_litellm_config (DB) ──────────────────────────────────────────

async def _add_config(db_session, purpose: str, *, is_default: bool, extra: dict | None = None):
    cfg = AIModelConfig(
        id=uuid.uuid4(),
        name=f"cfg-{purpose}-{uuid.uuid4().hex[:6]}",
        provider="openai",
        model_name="gpt-4o",
        purpose=purpose,
        api_key="sk-test",
        base_url=None,
        extra_config=extra,
        is_default=is_default,
        is_active=True,
    )
    db_session.add(cfg)
    await db_session.flush()
    return cfg


@pytest.mark.asyncio
async def test_get_default_reads_extra_config(db_session):
    await _add_config(
        db_session, "chat", is_default=True,
        extra={"max_tokens": 4096, "temperature": 0.2, "top_p": 0.8, "api_version": "2024-01"},
    )
    cfg = await get_default_litellm_config(db_session, "chat")
    assert cfg.max_tokens == 4096
    assert cfg.temperature == 0.2
    assert cfg.api_version == "2024-01"
    # extra giữ param phụ, KHÔNG lặp api_version/max_tokens/temperature.
    assert cfg.extra.get("top_p") == 0.8
    assert "api_version" not in cfg.extra and "max_tokens" not in cfg.extra


@pytest.mark.asyncio
async def test_config_params_dont_collide_with_call_site_overrides(db_session):
    # C1 regression: config (DB extra_config) có temperature/seed/stream; call-site (review.py)
    # truyền lại qua overrides → một dict DUY NHẤT, override THẮNG, KHÔNG duplicate-kwarg crash.
    await _add_config(
        db_session, "chat", is_default=True,
        extra={"temperature": 0.7, "seed": 1, "stream": True, "top_p": 0.5},
    )
    cfg = await get_default_litellm_config(db_session, "chat")
    kw = cfg.to_kwargs(stream=False, temperature=0, seed=42)  # pattern review.py sau fix
    assert kw["temperature"] == 0 and kw["seed"] == 42 and kw["stream"] is False
    assert kw["top_p"] == 0.5  # param phụ giữ nguyên
    # Mô phỏng splat vào hàm có sẵn các key này — KHÔNG lỗi "multiple values".
    def _fake_acompletion(**kwargs):
        return kwargs
    assert _fake_acompletion(messages=[], **kw)["temperature"] == 0


@pytest.mark.asyncio
async def test_vlm_falls_back_to_chat_without_raising(db_session):
    # Chỉ có default chat, KHÔNG có vlm → fallback chat, KHÔNG raise (M2).
    await _add_config(db_session, "chat", is_default=True, extra={"max_tokens": 2048})
    cfg = await get_default_litellm_config(db_session, "vlm")
    assert cfg.model.endswith("gpt-4o")
    assert cfg.max_tokens == 2048


# ── VALID_PURPOSES ───────────────────────────────────────────────────────────

def test_valid_purposes_includes_vlm():
    assert "vlm" in VALID_PURPOSES
