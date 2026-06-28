"""Phase 4 T2 — Fix VLM cắt cụt: text_extraction_service luôn truyền max_tokens cho VLM
acompletion (default 8192 ở lớp tiêu thụ — M1), override được qua vlm_kwargs/extra_config.

Test ASSERT KWARGS (max_tokens >= 8192) — KHÔNG assert độ dài output mock (M4: mock không
chứng minh được model cắt; điều cần chứng minh là code LUÔN gửi max_tokens đủ lớn).
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.services.text_extraction_service import TextExtractionService


def test_default_max_tokens_at_least_8192():
    ext = TextExtractionService(vlm_model="gpt-4o", vlm_kwargs={})
    assert ext._vlm_kwargs.get("max_tokens", 0) >= 8192


def test_respects_configured_max_tokens():
    # Admin cấu hình max_tokens qua extra_config (→ vlm_kwargs) → tôn trọng, KHÔNG ép 8192.
    ext = TextExtractionService(vlm_model="gpt-4o", vlm_kwargs={"max_tokens": 2000})
    assert ext._vlm_kwargs["max_tokens"] == 2000


def test_does_not_mutate_caller_kwargs():
    caller = {}
    TextExtractionService(vlm_model="gpt-4o", vlm_kwargs=caller)
    assert "max_tokens" not in caller  # không sửa dict của caller


@pytest.mark.asyncio
async def test_image_vlm_acompletion_passes_max_tokens():
    ext = TextExtractionService(vlm_model="gpt-4o", vlm_kwargs={})
    fake = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content="hello world"))]
    )
    with patch("litellm.acompletion", new=AsyncMock(return_value=fake)) as mock_ac:
        res = await ext._extract_image_vlm(b"\x89PNG\r\n\x1a\n", "image/png")
    assert res and res[0].text == "hello world"
    assert mock_ac.call_args.kwargs["max_tokens"] >= 8192
