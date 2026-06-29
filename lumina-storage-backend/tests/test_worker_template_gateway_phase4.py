"""Phase 4 T5c — worker extract_template/draft llm_call qua AIGateway.

Closure llm_call (non-stream, trả content) của extract_template_task +
extract_template_draft_task vốn trùng nhau → tách helper module-level
`_build_template_llm_call(db)` (DRY + testable). Khoá:
- complete() force stream=False (deterministic extraction).
- response_format forward qua overrides khi caller truyền (extract pipeline cần
  json_object); KHÔNG gắn khi caller bỏ trống.
- trả `resp.choices[0].message.content or ""`.
"""
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.models.core import AIModelConfig
from src.worker.tasks.document import _build_template_llm_call

pytestmark = pytest.mark.asyncio


def _add_default_chat(db_session) -> None:
    db_session.add(AIModelConfig(
        id=uuid.uuid4(), name="c", provider="openai", model_name="gpt-4o",
        purpose="chat", api_key="k", base_url=None, extra_config={},
        is_default=True, is_active=True,
    ))


async def test_llm_call_nonstream_with_response_format(db_session):
    _add_default_chat(db_session)
    await db_session.flush()

    fake = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="kết quả"))]
    )
    with patch("litellm.acompletion", new=AsyncMock(return_value=fake)) as m:
        llm_call = _build_template_llm_call(db_session)
        out = await llm_call(
            [{"role": "user", "content": "x"}],
            response_format={"type": "json_object"},
        )

    assert out == "kết quả"
    kw = m.call_args.kwargs
    assert kw["stream"] is False
    assert kw["response_format"] == {"type": "json_object"}


async def test_llm_call_omits_response_format_when_absent(db_session):
    _add_default_chat(db_session)
    await db_session.flush()

    fake = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=None))]
    )
    with patch("litellm.acompletion", new=AsyncMock(return_value=fake)) as m:
        llm_call = _build_template_llm_call(db_session)
        out = await llm_call([{"role": "user", "content": "x"}])

    assert out == ""  # content None → fallback ""
    assert "response_format" not in m.call_args.kwargs
    assert m.call_args.kwargs["stream"] is False
