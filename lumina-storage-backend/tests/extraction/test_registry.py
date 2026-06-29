"""Phase 5b Task 1 — provider registry: local_hybrid đăng ký sẵn (mặc định, luôn có)."""
from src.extraction.registry import REGISTRY, get_provider_class
from src.extraction.local_hybrid import LocalHybridProvider


def test_local_hybrid_registered():
    assert "local_hybrid" in REGISTRY
    assert get_provider_class("local_hybrid") is LocalHybridProvider


def test_unknown_provider_returns_none():
    assert get_provider_class("nope") is None
