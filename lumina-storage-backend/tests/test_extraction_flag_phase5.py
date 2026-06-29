"""Phase 5a R10 — Settings.extraction_blue_green là field pydantic hợp lệ (default True,
override được qua env/init). Đóng gap alignment-audit (xác nhận flag binding)."""
from src.core.config import Settings


def test_extraction_blue_green_default_true():
    s = Settings(secret_key="x" * 40)
    assert s.extraction_blue_green is True


def test_extraction_blue_green_override():
    s = Settings(secret_key="x" * 40, extraction_blue_green=False)
    assert s.extraction_blue_green is False


def test_extraction_blue_green_env(monkeypatch):
    # pydantic-settings đọc từ env (case-insensitive) → rollback bằng EXTRACTION_BLUE_GREEN=false.
    monkeypatch.setenv("EXTRACTION_BLUE_GREEN", "false")
    s = Settings(secret_key="x" * 40)
    assert s.extraction_blue_green is False
