"""Task 2.4b — mã hóa S3 credential (access_key/secret_key) trong JSONB StorageConfig.config.

EncryptedString (TypeDecorator) không áp được vì secret nằm nested trong cột JSONB,
nên dùng field-level encryption: encrypt trước khi lưu, decrypt khi đọc, mask khi trả response.
"""
import pytest
from sqlalchemy import text

from src.core.encryption import (
    decrypt_config_secrets,
    encrypt_config_secrets,
    redact_config_secrets,
)
from src.schemas.document import (
    StorageConfigCreateRequest,
    StorageConfigUpdateRequest,
)
from src.services.storage import S3StorageBackend, get_storage_backend
from src.services.storage_config import StorageConfigService


# --- Unit: field-level helpers ---

def test_encrypt_decrypt_config_round_trip():
    cfg = {"bucket": "b", "access_key": "AKIA123", "secret_key": "topsecret"}
    enc = encrypt_config_secrets(cfg)
    assert enc["access_key"].startswith("enc:")
    assert enc["secret_key"].startswith("enc:")
    assert enc["bucket"] == "b"  # field không phải secret giữ nguyên
    assert cfg["secret_key"] == "topsecret"  # không mutate input
    dec = decrypt_config_secrets(enc)
    assert dec["access_key"] == "AKIA123"
    assert dec["secret_key"] == "topsecret"


def test_encrypt_config_idempotent():
    cfg = {"secret_key": "s"}
    once = encrypt_config_secrets(cfg)
    twice = encrypt_config_secrets(once)
    assert once["secret_key"] == twice["secret_key"]  # không mã hóa 2 lớp
    assert decrypt_config_secrets(twice)["secret_key"] == "s"


def test_helpers_none_and_empty_safe():
    assert encrypt_config_secrets(None) is None
    assert decrypt_config_secrets({}) == {}
    assert encrypt_config_secrets({"bucket": "b"}) == {"bucket": "b"}


def test_redact_masks_secrets():
    enc = encrypt_config_secrets(
        {"access_key": "AKIA1234", "secret_key": "supersecretvalue", "bucket": "b"}
    )
    red = redact_config_secrets(enc)
    assert "•" in red["secret_key"]  # bullet •
    assert "supersecretvalue" not in red["secret_key"]
    assert red["bucket"] == "b"
    # Sentinel ẩn HOÀN TOÀN: không lộ ký tự gốc lẫn độ dài thật
    assert red["secret_key"] == red["access_key"]  # cùng sentinel cố định
    assert len(red["secret_key"]) != len("supersecretvalue")


# --- Service: mã hóa at-rest ---

@pytest.mark.asyncio
async def test_s3_secret_encrypted_at_rest(db_session):
    service = StorageConfigService(db_session)
    resp = await service.create_config(StorageConfigCreateRequest(
        name="s3", backend_type="s3",
        config={"bucket": "b", "endpoint_url": "http://x",
                "access_key": "AKIA999", "secret_key": "PLAINSECRET"},
    ))
    raw = await db_session.execute(
        text("SELECT config::text FROM storage_storageconfig WHERE id = :id"),
        {"id": resp.id},
    )
    stored = raw.scalar_one()
    assert "PLAINSECRET" not in stored
    assert "AKIA999" not in stored
    assert "enc:" in stored


# --- Read path: get_storage_backend giải mã trước khi dựng backend ---

@pytest.mark.asyncio
async def test_get_storage_backend_decrypts(db_session, monkeypatch):
    service = StorageConfigService(db_session)
    resp = await service.create_config(StorageConfigCreateRequest(
        name="s3r", backend_type="s3",
        config={"bucket": "b", "endpoint_url": "http://x",
                "access_key": "AKIAREAD", "secret_key": "REALSECRET"},
    ))
    cfg = await service.repo.get_by_id(resp.id)

    captured: dict = {}

    def fake_init(self, bucket, access_key, secret_key, region="us-east-1", endpoint_url=None):
        captured.update(access_key=access_key, secret_key=secret_key)

    monkeypatch.setattr(S3StorageBackend, "__init__", fake_init)
    get_storage_backend(cfg)
    assert captured["access_key"] == "AKIAREAD"
    assert captured["secret_key"] == "REALSECRET"


# --- Response: mask không lộ plaintext ---

@pytest.mark.asyncio
async def test_response_masks_secret(db_session):
    service = StorageConfigService(db_session)
    resp = await service.create_config(StorageConfigCreateRequest(
        name="s3resp", backend_type="s3",
        config={"bucket": "b", "access_key": "AKIARESP", "secret_key": "DONTLEAK"},
    ))
    assert "DONTLEAK" not in str(resp.config)
    assert "enc:" not in str(resp.config)  # không lộ ciphertext thô
    assert "•" in resp.config["secret_key"]
    assert "DO" not in resp.config["secret_key"]  # không lộ ký tự đầu (mask một phần)
    assert "AK" not in resp.config["access_key"]


# --- Update round-trip: secret đã mask không ghi đè bản gốc ---

@pytest.mark.asyncio
async def test_update_with_masked_secret_preserves_original(db_session):
    service = StorageConfigService(db_session)
    resp = await service.create_config(StorageConfigCreateRequest(
        name="s3upd", backend_type="s3",
        config={"bucket": "b", "access_key": "AKIAUPD", "secret_key": "ORIGINALSECRET"},
    ))
    # FE nhận config đã mask, đổi bucket rồi gửi lại nguyên dict (secret vẫn đang mask)
    new_config = dict(resp.config)
    new_config["bucket"] = "b2"
    await service.update_config(resp.id, StorageConfigUpdateRequest(config=new_config))

    cfg = await service.repo.get_by_id(resp.id)
    dec = decrypt_config_secrets(cfg.config)
    assert dec["secret_key"] == "ORIGINALSECRET"  # giữ nguyên, mask không ghi đè
    assert cfg.config["bucket"] == "b2"


@pytest.mark.asyncio
async def test_update_dropping_secret_does_not_retain_stale(db_session):
    """Đổi sang config không có secret (vd S3→local) → KHÔNG sót credential cũ trong JSONB."""
    service = StorageConfigService(db_session)
    resp = await service.create_config(StorageConfigCreateRequest(
        name="s3drop", backend_type="s3",
        config={"bucket": "b", "access_key": "AKIADROP", "secret_key": "STALESECRET"},
    ))
    await service.update_config(
        resp.id,
        StorageConfigUpdateRequest(backend_type="local", config={"base_dir": "/data"}),
    )
    cfg = await service.repo.get_by_id(resp.id)
    assert "secret_key" not in cfg.config  # secret cũ không bị giữ lại
    assert "access_key" not in cfg.config
    assert "STALESECRET" not in str(cfg.config)
    assert cfg.config["base_dir"] == "/data"
