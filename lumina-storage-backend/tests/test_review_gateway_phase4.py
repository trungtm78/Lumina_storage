"""Phase 4 T5 — review._call_llm migrate qua AIGateway: GIỮ deterministic (temperature=0,
seed=42, stream=False) dù config có temperature khác → chấm điểm review ổn định (C1)."""
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.models.core import AIModelConfig
from src.services.review_service import ReviewService

pytestmark = pytest.mark.asyncio


async def test_review_call_llm_keeps_deterministic_params(db_session):
    db_session.add(AIModelConfig(
        id=uuid.uuid4(), name="c", provider="openai", model_name="gpt-4o",
        purpose="chat", api_key="k", base_url=None,
        extra_config={"temperature": 0.9, "seed": 1},  # config khác → override phải thắng
        is_default=True, is_active=True,
    ))
    await db_session.flush()

    fake = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"x": 1}'))])
    with patch("litellm.acompletion", new=AsyncMock(return_value=fake)) as m:
        out = await ReviewService(db_session).call_llm("hello")

    assert out == {"x": 1}
    kw = m.call_args.kwargs
    assert kw["temperature"] == 0 and kw["seed"] == 42 and kw["stream"] is False
