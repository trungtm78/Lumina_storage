"""Phase 5b Task 6 — AzureDIProvider (Azure Document Intelligence, lazy azure-ai-documentintelligence).

Mock SDK qua sys.modules: extract analyze 'prebuilt-layout' markdown → cắt content theo page
spans → PageResult per trang; test_connection cần endpoint + ok / SDK-missing.
"""
import sys
from types import SimpleNamespace

import pytest

from src.extraction.providers.azure_di import AzureDIProvider

pytestmark = pytest.mark.asyncio


_CONTENT = "page one content\npage two content"


class _FakeResult:
    content = _CONTENT
    pages = [
        SimpleNamespace(page_number=1, spans=[SimpleNamespace(offset=0, length=16)]),
        SimpleNamespace(page_number=2, spans=[SimpleNamespace(offset=17, length=16)]),
    ]


class _FakePoller:
    def result(self):
        return _FakeResult()


class _FakeClient:
    def __init__(self, endpoint=None, credential=None):
        self.endpoint = endpoint

    def begin_analyze_document(self, model_id, **kwargs):
        return _FakePoller()


@pytest.fixture
def fake_azure(monkeypatch):
    monkeypatch.setitem(sys.modules, "azure", SimpleNamespace())
    monkeypatch.setitem(sys.modules, "azure.ai", SimpleNamespace())
    monkeypatch.setitem(sys.modules, "azure.ai.documentintelligence",
                        SimpleNamespace(DocumentIntelligenceClient=_FakeClient))
    monkeypatch.setitem(sys.modules, "azure.core", SimpleNamespace())
    monkeypatch.setitem(sys.modules, "azure.core.credentials",
                        SimpleNamespace(AzureKeyCredential=lambda key: SimpleNamespace(key=key)))


async def test_extract_maps_pages_by_spans(fake_azure):
    pages = await AzureDIProvider(api_key="k", base_url="https://x").extract(
        b"pdf", "application/pdf", ".pdf"
    )
    assert [p.page_number for p in pages] == [1, 2]
    assert pages[0].text == "page one content"
    assert pages[1].text == "page two content"


async def test_test_connection_needs_endpoint():
    ok, msg = await AzureDIProvider(api_key="k", base_url=None).test_connection()
    assert ok is False and "endpoint" in msg.lower()


async def test_test_connection_needs_api_key():
    ok, msg = await AzureDIProvider(api_key=None, base_url="https://x").test_connection()
    assert ok is False and "api_key" in msg.lower()


async def test_extract_requests_unicode_code_point(fake_azure):
    # codex P2: phải truyền string_index_type=unicodeCodePoint (offset khớp Python str — VN dấu).
    captured = {}

    class _CapClient(_FakeClient):
        def begin_analyze_document(self, model_id, **kwargs):
            captured.update(kwargs)
            return _FakePoller()

    import sys
    sys.modules["azure.ai.documentintelligence"].DocumentIntelligenceClient = _CapClient
    await AzureDIProvider(api_key="k", base_url="https://x").extract(b"x", "application/pdf", ".pdf")
    assert captured.get("string_index_type") == "unicodeCodePoint"


async def test_test_connection_ok(fake_azure):
    ok, _ = await AzureDIProvider(api_key="k", base_url="https://x").test_connection()
    assert ok is True


async def test_test_connection_sdk_missing():
    # azure SDK không cài trong test env → import raise → "chưa cài".
    ok, msg = await AzureDIProvider(api_key="k", base_url="https://x").test_connection()
    assert ok is False and "chưa cài" in msg.lower()


async def test_registered():
    from src.extraction.registry import get_provider_class
    assert get_provider_class("azure_di") is AzureDIProvider
