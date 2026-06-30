"""Phase 5b Task 10 — golden provider compare: MỌI provider tuân thủ contract ExtractionProvider
+ chuẩn hóa về PageResult hợp lệ (page_number liên tục từ 1, text/confidence đúng kiểu).

Real API integration (chất lượng/chi phí/độ trễ so sánh thực) cần API key — ngoài CI; golden
này khoá CONTRACT conformance (phần gateway thực bảo đảm) qua mock SDK.
"""
import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.extraction.base import ExtractionProvider
from src.extraction.registry import REGISTRY

_REQUIRED = {"local_hybrid", "gemini", "mistral", "azure_di", "landing_ai"}


def test_all_registered_providers_implement_contract():
    assert set(REGISTRY) >= _REQUIRED
    for name, cls in REGISTRY.items():
        assert issubclass(cls, ExtractionProvider)
        assert isinstance(cls.name, str) and cls.name == name
        assert inspect.iscoroutinefunction(cls.extract)
        assert inspect.iscoroutinefunction(cls.test_connection)
        assert callable(cls.from_config)


def test_local_hybrid_and_external_always_available_flags():
    # local_hybrid + gemini không SDK optional → luôn khả dụng; còn lại tùy SDK.
    from src.extraction.local_hybrid import LocalHybridProvider
    from src.extraction.providers.gemini import GeminiProvider

    assert LocalHybridProvider.is_available()
    assert GeminiProvider.is_available()


@pytest.mark.asyncio
async def test_pageresult_contract_contiguous_pages():
    # Provider chuẩn hóa → PageResult page_number LIÊN TỤC từ 1, text non-empty, confidence float.
    from src.extraction.providers.gemini import GeminiProvider

    content = "trang một\n\n---PAGE-BREAK---\n\ntrang hai\n\n---PAGE-BREAK---\n\ntrang ba"
    fake = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )
    with patch("litellm.acompletion", new=AsyncMock(return_value=fake)):
        pages = await GeminiProvider(api_key="k").extract(b"x", "application/pdf", ".pdf")

    assert [p.page_number for p in pages] == list(range(1, len(pages) + 1))
    assert all(p.text for p in pages)
    assert all(isinstance(p.confidence, float) for p in pages)
