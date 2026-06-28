"""Test tách ENCRYPTION_KEY khỏi SECRET_KEY.

Mã hóa credential phải dùng ENCRYPTION_KEY riêng, độc lập với SECRET_KEY (JWT).
Đổi SECRET_KEY không được ảnh hưởng khả năng giải mã dữ liệu đã mã hóa.
"""
import pytest


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    from src.core import config
    config.get_settings.cache_clear()
    yield
    config.get_settings.cache_clear()


def test_roundtrip_uses_encryption_key(monkeypatch):
    monkeypatch.setenv("ENCRYPTION_KEY", "k" * 40)
    monkeypatch.setenv("SECRET_KEY", "s" * 40)
    from src.core import config, encryption
    config.get_settings.cache_clear()
    enc = encryption.encrypt_value("hello-secret")
    assert enc.startswith("enc:")
    assert encryption.decrypt_value(enc) == "hello-secret"


def test_encryption_independent_of_secret_key(monkeypatch):
    monkeypatch.setenv("ENCRYPTION_KEY", "k" * 40)
    monkeypatch.setenv("SECRET_KEY", "s" * 40)
    from src.core import config, encryption
    config.get_settings.cache_clear()
    enc = encryption.encrypt_value("data")
    # đổi SECRET_KEY KHÔNG được làm hỏng giải mã (vì dùng ENCRYPTION_KEY riêng)
    monkeypatch.setenv("SECRET_KEY", "different-secret-key-value-1234567890")
    config.get_settings.cache_clear()
    assert encryption.decrypt_value(enc) == "data"


def test_decrypt_falls_back_to_legacy_secret_key(monkeypatch):
    """Migration: data mã hóa bằng SECRET_KEY (trước khi có ENCRYPTION_KEY)
    vẫn phải giải mã được sau khi thêm ENCRYPTION_KEY mới (fallback legacy)."""
    monkeypatch.delenv("ENCRYPTION_KEY", raising=False)
    monkeypatch.setenv("SECRET_KEY", "legacy-secret-key-1234567890-abcdef")
    from src.core import config, encryption
    config.get_settings.cache_clear()
    enc = encryption.encrypt_value("legacy-data")  # mã hóa bằng SECRET_KEY
    # giờ thêm ENCRYPTION_KEY mới (khác hoàn toàn)
    monkeypatch.setenv("ENCRYPTION_KEY", "brand-new-encryption-key-0987654321")
    config.get_settings.cache_clear()
    assert encryption.decrypt_value(enc) == "legacy-data"  # fallback cứu
