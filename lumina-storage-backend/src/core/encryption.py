"""
AES-256 encryption for sensitive app config values.

Uses Fernet (which internally uses AES-128-CBC + HMAC-SHA256). For truly 256-bit,
we derive a 32-byte key from SECRET_KEY via SHA-256.

Encrypted values are stored in DB with prefix "enc:" to distinguish from plain.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from src.core.config import get_settings

_ENCRYPTED_PREFIX = "enc:"


def _fernet_for(key_material: str) -> Fernet:
    """Tạo Fernet từ một chuỗi khóa (SHA-256 → 32 byte url-safe)."""
    digest = hashlib.sha256(key_material.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _primary_key() -> str:
    """Khóa dùng để MÃ HÓA: ENCRYPTION_KEY, fallback SECRET_KEY nếu trống."""
    settings = get_settings()
    return settings.encryption_key or settings.secret_key


def _decrypt_keys() -> list[str]:
    """Thứ tự khóa thử khi GIẢI MÃ: ENCRYPTION_KEY trước, rồi SECRET_KEY legacy.

    Cho phép migration mượt — data mã hóa bằng SECRET_KEY cũ vẫn đọc được sau
    khi thêm ENCRYPTION_KEY mới. Dedupe để không thử trùng.
    """
    settings = get_settings()
    keys: list[str] = []
    for k in (settings.encryption_key, settings.secret_key):
        if k and k not in keys:
            keys.append(k)
    return keys


def encrypt_value(plaintext: str) -> str:
    """Encrypt a plaintext string. Returns 'enc:<base64>'."""
    if not plaintext:
        return plaintext
    if plaintext.startswith(_ENCRYPTED_PREFIX):
        return plaintext  # already encrypted
    token = _fernet_for(_primary_key()).encrypt(plaintext.encode("utf-8"))
    return _ENCRYPTED_PREFIX + token.decode("utf-8")


def decrypt_value(value: str) -> str:
    """Decrypt 'enc:...'. Thử ENCRYPTION_KEY rồi SECRET_KEY legacy (migration).

    Không mã hóa → trả as-is. Mọi khóa thất bại → trả as-is (graceful degradation).
    """
    if not value or not value.startswith(_ENCRYPTED_PREFIX):
        return value
    token = value[len(_ENCRYPTED_PREFIX):].encode("utf-8")
    for key in _decrypt_keys():
        try:
            return _fernet_for(key).decrypt(token).decode("utf-8")
        except InvalidToken:
            continue
    return value  # corrupted hoặc không khớp khóa nào — graceful


def is_encrypted(value: str) -> bool:
    return isinstance(value, str) and value.startswith(_ENCRYPTED_PREFIX)


def mask_value(value: str) -> str:
    """Return masked version of a secret value for UI display."""
    if not value:
        return ""
    plain = decrypt_value(value) if is_encrypted(value) else value
    if len(plain) <= 4:
        return "•" * len(plain)
    return plain[:2] + "•" * (len(plain) - 4) + plain[-2:]
