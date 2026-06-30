"""Phase 5b Task 5 — MistralProvider (Mistral OCR API, lazy SDK `mistralai`).

Mock SDK qua sys.modules: extract map ocr_response.pages (index/markdown) → PageResult;
document_url cho PDF, image_url cho ảnh; test_connection ok / SDK-missing. KHÔNG gọi API thật.
"""
import sys
from types import SimpleNamespace

import pytest

from src.extraction.providers.mistral import MistralProvider

pytestmark = pytest.mark.asyncio


class _FakeOcr:
    last_document = None

    def process(self, model, document):
        _FakeOcr.last_document = document
        return SimpleNamespace(pages=[
            SimpleNamespace(index=0, markdown="trang 1 md"),
            SimpleNamespace(index=1, markdown="trang 2 md"),
        ])


class _FakeClient:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.ocr = _FakeOcr()
        self.models = SimpleNamespace(list=lambda: ["m"])


@pytest.fixture
def fake_mistral(monkeypatch):
    monkeypatch.setitem(sys.modules, "mistralai", SimpleNamespace(Mistral=_FakeClient))
    _FakeOcr.last_document = None


async def test_extract_maps_pages(fake_mistral):
    pages = await MistralProvider(api_key="k").extract(b"pdf", "application/pdf", ".pdf")
    assert [p.page_number for p in pages] == [1, 2]
    assert pages[0].text == "trang 1 md"
    assert _FakeOcr.last_document["type"] == "document_url"


async def test_extract_image_uses_image_url_canonical_mime(fake_mistral):
    # octet-stream + .png → canonical image/png → image_url (codex P2).
    await MistralProvider(api_key="k").extract(b"img", "application/octet-stream", ".png")
    assert _FakeOcr.last_document["type"] == "image_url"
    assert _FakeOcr.last_document["image_url"].startswith("data:image/png;base64,")


async def test_test_connection_ok(fake_mistral):
    ok, _ = await MistralProvider(api_key="k").test_connection()
    assert ok is True


async def test_test_connection_sdk_missing(monkeypatch):
    # KHÔNG inject fake → `from mistralai import Mistral` raise ImportError → báo "chưa cài".
    monkeypatch.setitem(sys.modules, "mistralai", None)
    ok, msg = await MistralProvider(api_key="k").test_connection()
    assert ok is False and "chưa cài" in msg.lower()


async def test_registered():
    from src.extraction.registry import get_provider_class
    assert get_provider_class("mistral") is MistralProvider
