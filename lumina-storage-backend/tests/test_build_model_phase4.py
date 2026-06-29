"""Phase 4 T7 (part 1) — build_model forward **extra (codex T3 P2 deferred).

build_model nhận **extra nhưng trước đây DROP hoàn toàn → gateway.langgraph_model(**overrides)
truyền temperature/max_tokens... bị mất. Forward xuống constructor. Path LIVE (stream_agent)
KHÔNG truyền extra → không đổi hành vi.
"""
import uuid

import pytest

from src.ai import AIGateway
from src.models.core import AIModelConfig
from src.services.agent import build_model


def _add_default_chat(db_session, extra: dict | None = None) -> None:
    db_session.add(AIModelConfig(
        id=uuid.uuid4(), name="c", provider="openai", model_name="gpt-4o",
        purpose="chat", api_key="k", base_url=None, extra_config=extra,
        is_default=True, is_active=True,
    ))


def test_build_model_openai_forwards_extra():
    m = build_model("gpt-4o", api_key="k", temperature=0.3)
    assert m.temperature == 0.3


def test_build_model_azure_forwards_extra():
    m = build_model("azure/dep", api_key="k", api_base="https://e", temperature=0.1)
    assert m.temperature == 0.1


def test_build_model_no_extra_unchanged():
    # Không extra → vẫn build OK (path LIVE stream_agent).
    m = build_model("gpt-4o", api_key="k")
    assert m.model_name == "gpt-4o" or getattr(m, "model", None) == "gpt-4o"


@pytest.mark.asyncio
async def test_langgraph_model_forwards_config_generation_params(db_session):
    # codex T7 P2: gateway.langgraph_model phải forward cfg.temperature/max_tokens/extra
    # xuống build_model (đối xứng langchain_model) — admin extra_config tới được model.
    _add_default_chat(db_session, extra={"temperature": 0.2})
    await db_session.flush()
    m = await AIGateway(db_session).langgraph_model()
    assert m.temperature == 0.2


@pytest.mark.asyncio
async def test_langgraph_model_override_wins(db_session):
    # C1: per-call override thắng config.
    _add_default_chat(db_session, extra={"temperature": 0.2})
    await db_session.flush()
    m = await AIGateway(db_session).langgraph_model(temperature=0.9)
    assert m.temperature == 0.9
