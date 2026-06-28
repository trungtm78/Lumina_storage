"""Test guard SECRET_KEY: mặc định strict, chỉ lỏng khi env rõ là dev/test.

Chính sách (sau codex review): chặn secret yếu TRỪ KHI app_env thuộc tập an
toàn (development/test/local). Production hoặc env không rõ → fail-fast. Ngoài
placeholder, còn chặn secret quá ngắn và low-entropy (vd lặp 1 ký tự).
"""
import secrets

import pytest

from src.core.config import Settings, validate_secrets


def test_guard_raises_on_placeholder_in_production():
    s = Settings(app_env="production", secret_key="changeme")
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        validate_secrets(s)


def test_guard_raises_on_short_secret_in_production():
    s = Settings(app_env="production", secret_key="short")
    with pytest.raises(RuntimeError):
        validate_secrets(s)


def test_guard_raises_on_low_entropy_secret():
    # "x" * 40 đủ dài nhưng entropy thấp → vẫn phải chặn.
    s = Settings(app_env="production", secret_key="x" * 40)
    with pytest.raises(RuntimeError):
        validate_secrets(s)


def test_guard_raises_in_unknown_env_with_weak_secret():
    # env không thuộc tập an toàn (vd staging) → coi như production-grade, strict.
    s = Settings(app_env="staging", secret_key="changeme")
    with pytest.raises(RuntimeError):
        validate_secrets(s)


def test_guard_normalizes_case_and_whitespace():
    s = Settings(app_env="production", secret_key="  ChangeMe  ")
    with pytest.raises(RuntimeError):
        validate_secrets(s)


def test_guard_blocks_common_long_placeholder():
    s = Settings(app_env="production", secret_key="your-secret-key-here-change-me-in-production")
    with pytest.raises(RuntimeError):
        validate_secrets(s)


def test_guard_passes_in_development_with_placeholder():
    s = Settings(app_env="development", secret_key="changeme")
    validate_secrets(s)  # safe env → chỉ warn, không raise


def test_guard_passes_with_strong_secret():
    s = Settings(app_env="production", secret_key=secrets.token_urlsafe(32))
    validate_secrets(s)
