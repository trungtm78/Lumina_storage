"""Test guard SECRET_KEY: production phải fail-fast nếu secret yếu/placeholder."""
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


def test_guard_passes_in_development_with_placeholder():
    s = Settings(app_env="development", secret_key="changeme")
    validate_secrets(s)  # chỉ warn, không raise


def test_guard_passes_with_strong_secret():
    s = Settings(app_env="production", secret_key="x" * 40)
    validate_secrets(s)
