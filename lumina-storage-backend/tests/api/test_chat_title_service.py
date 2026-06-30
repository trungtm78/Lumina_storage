"""P8 W2.2 — chat_title_service: sinh title ở SESSION RIÊNG (best-effort).

Khóa: _resolve_title_llm dựng title-LLM deterministic (max_tokens=20, non-stream); background
function chạy ở session riêng (session_factory injectable, mirror worker test) + graceful khi
session không tồn tại. Happy-path full (FK User) phủ bởi characterization (move verbatim code đã đúng).
"""
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.core.config import get_settings
from src.domain.chat import chat_title_service as cts

pytestmark = pytest.mark.asyncio


async def test_resolve_title_llm_builds_deterministic(db_session):
    with patch("src.domain.chat.chat_title_service.SkillService") as SkillCls:
        SkillCls.return_value.resolve_model = AsyncMock(
            return_value=("openai/gpt-4o", "key", "base", "v1", {})
        )
        llm = await cts._resolve_title_llm(db_session, get_settings())
    assert llm.model == "openai/gpt-4o"
    assert llm.max_tokens == 20
    assert llm.streaming is False


async def test_generate_title_background_graceful_when_session_missing(test_engine):
    sf = async_sessionmaker(test_engine, expire_on_commit=False)
    # session_id không tồn tại → return graceful (if not session), KHÔNG raise, KHÔNG gọi LLM.
    with patch.object(cts, "_resolve_title_llm", new=AsyncMock()) as resolve:
        await cts.generate_title_background(
            uuid.uuid4(), "u", "a", get_settings(), session_factory=sf
        )
    resolve.assert_not_called()
