"""Phase 5b Task 7 — LandingAIProvider (Landing AI ADE, lazy `agentic-doc`).

Mock SDK qua sys.modules: extract parse → gộp chunks theo page (grounding.page 0-based) →
PageResult per trang; test_connection cần api_key + ok / SDK-missing. KHÔNG gọi API thật.
"""
import os
import sys
from types import SimpleNamespace

import pytest

from src.extraction.providers.landing_ai import LandingAIProvider

pytestmark = pytest.mark.asyncio


def _chunk(text, page):
    return SimpleNamespace(text=text, grounding=[SimpleNamespace(page=page)])


class _Doc:
    chunks = [_chunk("trang1 a", 0), _chunk("trang1 b", 0), _chunk("trang2 x", 1)]
    markdown = "full md"


@pytest.fixture
def fake_agentic(monkeypatch):
    captured = {}

    def _parse(path, **kwargs):
        captured["path"] = path
        return [_Doc()]

    monkeypatch.setitem(sys.modules, "agentic_doc", SimpleNamespace())
    monkeypatch.setitem(sys.modules, "agentic_doc.parse", SimpleNamespace(parse=_parse))
    return captured


async def test_extract_groups_chunks_by_page(fake_agentic):
    pages = await LandingAIProvider(api_key="k").extract(b"pdfbytes", "application/pdf", ".pdf")
    assert [p.page_number for p in pages] == [1, 2]
    assert pages[0].text == "trang1 a\n\ntrang1 b"
    assert pages[1].text == "trang2 x"


async def test_extract_handles_dict_grounding(monkeypatch):
    # codex P2: grounding dạng dict (SDK JSON-like) vẫn lấy đúng page (không fallback page 0).
    class _DictDoc:
        chunks = [
            {"text": "p1", "grounding": [{"page": 0}]},
            {"text": "p2", "grounding": [{"page": 1}]},
        ]

    monkeypatch.setitem(sys.modules, "agentic_doc", SimpleNamespace())
    monkeypatch.setitem(sys.modules, "agentic_doc.parse",
                        SimpleNamespace(parse=lambda path, **k: [_DictDoc()]))
    pages = await LandingAIProvider(api_key="k").extract(b"x", "application/pdf", ".pdf")
    assert [p.page_number for p in pages] == [1, 2]
    assert pages[1].text == "p2"


async def test_env_restored_after_extract(fake_agentic, monkeypatch):
    # env VISION_AGENT_API_KEY khôi phục sau extract (không rò key giữa config).
    monkeypatch.delenv("VISION_AGENT_API_KEY", raising=False)
    await LandingAIProvider(api_key="secret-key").extract(b"x", "application/pdf", ".pdf")
    assert "VISION_AGENT_API_KEY" not in os.environ  # đã restore (trước đó không có)


async def test_test_connection_needs_api_key():
    ok, msg = await LandingAIProvider(api_key=None).test_connection()
    assert ok is False and "api_key" in msg.lower()


async def test_test_connection_ok(fake_agentic):
    ok, _ = await LandingAIProvider(api_key="k").test_connection()
    assert ok is True


async def test_test_connection_sdk_missing():
    ok, msg = await LandingAIProvider(api_key="k").test_connection()
    assert ok is False and "chưa cài" in msg.lower()


async def test_registered():
    from src.extraction.registry import get_provider_class
    assert get_provider_class("landing_ai") is LandingAIProvider
