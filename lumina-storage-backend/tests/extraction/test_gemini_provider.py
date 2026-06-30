"""Phase 5b Task 4 — GeminiProvider (qua litellm, Gemini multimodal đọc PDF/ảnh native).

Mock litellm.acompletion: extract parse response → PageResult per trang (delimiter); model
chuẩn 'gemini/<model>' + api_key; test_connection ok/lỗi. KHÔNG gọi API thật.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.extraction.providers.gemini import GeminiProvider

pytestmark = pytest.mark.asyncio


def _resp(content):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


async def test_extract_parses_pages():
    fake = _resp("trang 1 nội dung\n\n---PAGE-BREAK---\n\ntrang 2 nội dung")
    with patch("litellm.acompletion", new=AsyncMock(return_value=fake)) as m:
        prov = GeminiProvider(api_key="k", model="gemini-2.0-flash")
        pages = await prov.extract(b"pdfbytes", "application/pdf", ".pdf")
    assert len(pages) == 2
    assert pages[0].page_number == 1 and "trang 1" in pages[0].text
    assert pages[1].page_number == 2
    kw = m.call_args.kwargs
    assert kw["model"] == "gemini/gemini-2.0-flash"
    assert kw["api_key"] == "k"
    # PDF → litellm 'file' content type (đúng shape document input).
    content = kw["messages"][0]["content"]
    assert content[1]["type"] == "file"
    assert content[1]["file"]["file_data"].startswith("data:application/pdf;base64,")


async def test_image_uses_image_url_and_canonical_mime():
    fake = _resp("ảnh nội dung")
    with patch("litellm.acompletion", new=AsyncMock(return_value=fake)) as m:
        # mime generic octet-stream + ext .png → canonicalize image/png → image_url.
        await GeminiProvider(api_key="k").extract(b"img", "application/octet-stream", ".png")
    content = m.call_args.kwargs["messages"][0]["content"]
    assert content[1]["type"] == "image_url"
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")


async def test_middle_blank_page_preserves_numbering():
    fake = _resp("trang 1\n\n---PAGE-BREAK---\n\n\n\n---PAGE-BREAK---\n\ntrang 3")
    with patch("litellm.acompletion", new=AsyncMock(return_value=fake)):
        pages = await GeminiProvider(api_key="k").extract(b"x", "application/pdf", ".pdf")
    assert [p.page_number for p in pages] == [1, 2, 3]  # blank giữa GIỮ số trang
    assert pages[1].text == ""  # trang 2 rỗng nhưng vẫn đúng vị trí
    assert "trang 3" in pages[2].text


async def test_extract_single_page_no_delim():
    fake = _resp("chỉ một trang")
    with patch("litellm.acompletion", new=AsyncMock(return_value=fake)):
        pages = await GeminiProvider(api_key="k").extract(b"x", "application/pdf", ".pdf")
    assert len(pages) == 1 and pages[0].page_number == 1


async def test_extract_empty_returns_empty():
    with patch("litellm.acompletion", new=AsyncMock(return_value=_resp(""))):
        pages = await GeminiProvider(api_key="k").extract(b"x", "application/pdf", ".pdf")
    assert pages == []


async def test_test_connection_ok_and_fail():
    with patch("litellm.acompletion", new=AsyncMock(return_value=_resp("ok"))):
        ok, _ = await GeminiProvider(api_key="k").test_connection()
    assert ok is True
    with patch("litellm.acompletion", new=AsyncMock(side_effect=RuntimeError("auth bad"))):
        ok, msg = await GeminiProvider(api_key="bad").test_connection()
    assert ok is False and "lỗi" in msg.lower()


async def test_registered_and_from_config():
    from src.extraction.registry import get_provider_class

    assert get_provider_class("gemini") is GeminiProvider
    prov = GeminiProvider.from_config(
        settings=None, api_key="k", options={"model": "gemini-1.5-pro"}
    )
    assert prov._model == "gemini-1.5-pro"
