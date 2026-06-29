"""Phase 4 T5b — generator.py migrate litellm.acompletion → AIGateway.

Khoá 2 hành vi tinh tế (mechanical sites khác chỉ là complete() + đọc content):
1. JSON site `_llm_propose_ops`: GIỮ response_format={"type":"json_object"} +
   non-stream (complete force stream=False) → parse JSON ổn định.
2. Stream site (document_to_template): closure tiêu thụ gw.stream + check
   request.is_disconnected mỗi delta → RAISE HTTPException(499) khi client ngắt.
3. Simple site (revise route): qua gateway, non-stream, trả content.
"""
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.api.v1.routes.generator import (
    _consume_stream_with_disconnect,
    _llm_propose_ops,
)
from src.models.core import AIModelConfig

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/generator"


def _add_default_chat(db_session) -> None:
    db_session.add(AIModelConfig(
        id=uuid.uuid4(), name="c", provider="openai", model_name="gpt-4o",
        purpose="chat", api_key="k", base_url=None, extra_config={},
        is_default=True, is_active=True,
    ))


# ── JSON site: _llm_propose_ops ───────────────────────────────────────────────
async def test_propose_ops_keeps_response_format_and_nonstream(db_session):
    _add_default_chat(db_session)
    await db_session.flush()

    fake = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content='{"ops": []}'))]
    )
    with patch("litellm.acompletion", new=AsyncMock(return_value=fake)) as m:
        ops, warnings = await _llm_propose_ops(
            db_session, {"b1": "hello"}, ["in đậm"]
        )

    assert ops == []
    kw = m.call_args.kwargs
    assert kw["response_format"] == {"type": "json_object"}
    assert kw["stream"] is False


# ── Stream site: helper tiêu thụ stream + disconnect ──────────────────────────
async def test_consume_stream_raises_499_on_disconnect():
    async def fake_stream():
        yield "a"
        yield "b"

    req = SimpleNamespace(is_disconnected=AsyncMock(side_effect=[False, True]))
    with pytest.raises(HTTPException) as ei:
        await _consume_stream_with_disconnect(fake_stream(), req)
    assert ei.value.status_code == 499


async def test_consume_stream_accumulates_when_connected():
    async def fake_stream():
        yield "Hello "
        yield "World"

    req = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
    out = await _consume_stream_with_disconnect(fake_stream(), req)
    assert out == "Hello World"


# ── Simple site: revise route qua gateway ─────────────────────────────────────
async def test_revise_route_uses_gateway_nonstream(async_client, db_session, auth_headers):
    _add_default_chat(db_session)
    await db_session.flush()

    fake = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="đã sửa {ten}"))]
    )
    with patch("litellm.acompletion", new=AsyncMock(return_value=fake)) as m:
        resp = await async_client.post(
            f"{BASE}/revise",
            json={"content": "cũ {{ten}}", "instruction": "sửa", "version": 1},
            headers=auth_headers,
        )

    assert resp.status_code == 200, resp.text
    assert m.call_args.kwargs["stream"] is False
    assert resp.json()["content"] == "đã sửa {ten}"
