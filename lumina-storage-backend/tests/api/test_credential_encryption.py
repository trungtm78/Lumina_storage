"""Test mã hóa credential at-rest: AIModelConfig.api_key lưu DB phải mã hóa."""
import pytest
from sqlalchemy import text

from src.models.core import AIModelConfig

pytestmark = pytest.mark.asyncio


async def test_api_key_encrypted_at_rest(db_session):
    cfg = AIModelConfig(
        name="t", provider="openai", model_name="gpt-4o", purpose="chat", api_key="sk-secret-123"
    )
    db_session.add(cfg)
    await db_session.flush()
    cfg_id = cfg.id

    # Giá trị THỰC trong DB phải mã hóa (không plaintext)
    raw = await db_session.execute(
        text("SELECT api_key FROM core_aimodelconfig WHERE id = :id"), {"id": cfg_id}
    )
    stored = raw.scalar_one()
    assert stored.startswith("enc:")
    assert "sk-secret-123" not in stored

    # ORM đọc lại → tự giải mã trả plaintext
    await db_session.refresh(cfg)
    assert cfg.api_key == "sk-secret-123"


async def test_no_double_encryption(db_session):
    """Gán giá trị ĐÃ mã hóa → không mã hóa lần 2 (guard idempotent)."""
    from src.core.encryption import encrypt_value

    pre = encrypt_value("sk-pre")  # đã 'enc:'
    cfg = AIModelConfig(name="t3", provider="openai", model_name="m", purpose="chat", api_key=pre)
    db_session.add(cfg)
    await db_session.flush()
    await db_session.refresh(cfg)
    # chỉ 1 lớp mã hóa → đọc ra plaintext gốc
    assert cfg.api_key == "sk-pre"


async def test_api_key_none_stays_none(db_session):
    cfg = AIModelConfig(
        name="t2", provider="ollama", model_name="llama", purpose="chat", api_key=None
    )
    db_session.add(cfg)
    await db_session.flush()
    await db_session.refresh(cfg)
    assert cfg.api_key is None
