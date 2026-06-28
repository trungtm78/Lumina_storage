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


def _get_fernet() -> Fernet:
    """Derive Fernet key from app SECRET_KEY (must be 32 url-safe bytes)."""
    settings = get_settings()
    raw_key = settings.secret_key.encode("utf-8")
    digest = hashlib.sha256(raw_key).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_value(plaintext: str) -> str:
    """Encrypt a plaintext string. Returns 'enc:<base64>'."""
    if not plaintext:
        return plaintext
    if plaintext.startswith(_ENCRYPTED_PREFIX):
        return plaintext  # already encrypted
    f = _get_fernet()
    token = f.encrypt(plaintext.encode("utf-8"))
    return _ENCRYPTED_PREFIX + token.decode("utf-8")


def decrypt_value(value: str) -> str:
    """Decrypt 'enc:...' string. Returns original plaintext. If not encrypted, returns as-is."""
    if not value or not value.startswith(_ENCRYPTED_PREFIX):
        return value
    f = _get_fernet()
    token = value[len(_ENCRYPTED_PREFIX):].encode("utf-8")
    try:
        return f.decrypt(token).decode("utf-8")
    except InvalidToken:
        return value  # corrupted or wrong key — return as-is for graceful degradation


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
