"""Phase 5b Task 3 — selector routing + fallback chain.

- config rỗng → chain == [local_hybrid] (zero-regression).
- routing: config provider khớp mime + priority → đứng trước; LocalHybrid LUÔN cuối.
- extract_with_fallback: provider chính raise → fallback sang LocalHybrid.
"""
import uuid
from types import SimpleNamespace

import pytest

from src.core.config import get_settings
from src.extraction.base import ExtractionProvider
from src.extraction.local_hybrid import LocalHybridProvider
from src.extraction.registry import REGISTRY, register
from src.extraction.selector import extract_with_fallback, resolve_extraction_chain
from src.models.extraction import ExtractionProviderConfig
from src.services.text_extraction_service import PageResult

pytestmark = pytest.mark.asyncio


class _DummyProvider(ExtractionProvider):
    name = "dummy"
    raise_it = False

    def __init__(self, **kwargs):
        pass

    @classmethod
    def from_config(cls, *, settings, api_key=None, base_url=None, options=None):
        return cls()

    async def extract(self, file_bytes, mime_type, extension):
        if _DummyProvider.raise_it:
            raise RuntimeError("dummy boom")
        return [PageResult(page_number=1, text="dummy", confidence=1.0)]


@pytest.fixture(autouse=True)
def _register_dummy():
    register("dummy", _DummyProvider)
    _DummyProvider.raise_it = False
    yield
    REGISTRY.pop("dummy", None)


async def test_empty_config_only_localhybrid(db_session):
    # Excel doc → LocalHybrid không cần vlm → chain chỉ [local_hybrid] (zero-regression).
    doc = SimpleNamespace(extension=".xlsx", mime_type="application/vnd.ms-excel")
    chain = await resolve_extraction_chain(db_session, doc, get_settings())
    assert [p.name for p in chain] == ["local_hybrid"]


async def test_routing_picks_config_then_localhybrid_last(db_session, monkeypatch):
    # vlm resolve cho pdf (non-excel) → mock get_default tránh cần config thật.
    async def _fake_vlm(db, purpose):
        return SimpleNamespace(model="m", to_kwargs=lambda **o: {"model": "m"})
    monkeypatch.setattr("src.services.ai_model_config_service.get_default_litellm_config", _fake_vlm)

    db_session.add(ExtractionProviderConfig(
        id=uuid.uuid4(), name="d", provider="dummy", applies_to=["application/pdf"],
        priority=10, is_active=True,
    ))
    await db_session.flush()
    doc = SimpleNamespace(extension=".pdf", mime_type="application/pdf")
    chain = await resolve_extraction_chain(db_session, doc, get_settings())
    assert [p.name for p in chain] == ["dummy", "local_hybrid"]


async def test_routing_skips_non_matching_mime(db_session, monkeypatch):
    async def _fake_vlm(db, purpose):
        return SimpleNamespace(model="m", to_kwargs=lambda **o: {"model": "m"})
    monkeypatch.setattr("src.services.ai_model_config_service.get_default_litellm_config", _fake_vlm)

    db_session.add(ExtractionProviderConfig(
        id=uuid.uuid4(), name="d", provider="dummy", applies_to=["image/png"],
        priority=10, is_active=True,
    ))
    await db_session.flush()
    doc = SimpleNamespace(extension=".pdf", mime_type="application/pdf")  # không khớp image/png
    chain = await resolve_extraction_chain(db_session, doc, get_settings())
    assert [p.name for p in chain] == ["local_hybrid"]  # dummy bị bỏ


async def test_fallback_to_localhybrid_on_error():
    _DummyProvider.raise_it = True
    chain = [_DummyProvider(), LocalHybridProvider(gotenberg_url="")]
    pages = await extract_with_fallback(chain, b"noi dung text", "text/plain", ".txt")
    assert pages and pages[0].text  # dummy raise → LocalHybrid trích plaintext


async def test_all_empty_returns_empty():
    class _Empty(ExtractionProvider):
        name = "empty"
        async def extract(self, *a):
            return []
    pages = await extract_with_fallback([_Empty()], b"x", "text/plain", ".txt")
    assert pages == []


async def test_local_hybrid_config_not_duplicated(db_session):
    # Admin set config provider=local_hybrid → KHÔNG nhân đôi (skip vòng lặp + append 1 lần).
    db_session.add(ExtractionProviderConfig(
        id=uuid.uuid4(), name="lh", provider="local_hybrid", priority=5, is_active=True,
    ))
    await db_session.flush()
    doc = SimpleNamespace(extension=".xlsx", mime_type="application/vnd.ms-excel")
    chain = await resolve_extraction_chain(db_session, doc, get_settings())
    assert [p.name for p in chain] == ["local_hybrid"]


async def test_fallback_chain_raise_empty_good():
    class _Raiser(ExtractionProvider):
        name = "r"
        async def extract(self, *a):
            raise RuntimeError("boom")

    class _Empty(ExtractionProvider):
        name = "e"
        async def extract(self, *a):
            return []

    class _Good(ExtractionProvider):
        name = "g"
        async def extract(self, *a):
            return [PageResult(page_number=1, text="good", confidence=1.0)]

    pages = await extract_with_fallback([_Raiser(), _Empty(), _Good()], b"x", "text/plain", ".txt")
    assert pages and pages[0].text == "good"


async def test_all_raise_propagates_last():
    class _R(ExtractionProvider):
        name = "r"
        async def extract(self, *a):
            raise ValueError("the boom")

    with pytest.raises(ValueError, match="the boom"):
        await extract_with_fallback([_R()], b"x", "text/plain", ".txt")
