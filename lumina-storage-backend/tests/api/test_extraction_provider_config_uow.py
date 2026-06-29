"""Phase 5b Task 2 — ExtractionProviderConfig persistence (mirror AIModelConfig).

CRUD route KHÔNG commit (boundary); api_key mã hóa at-rest (EncryptedString); Response OMIT
api_key; require_admin; one-default global constraint.
"""
import uuid

import pytest
from sqlalchemy import text as sa_text

from src.models.extraction import ExtractionProviderConfig

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/extraction-provider-configs"


def _spy_commit(db_session, calls: list):
    orig = db_session.commit

    async def spy():
        calls.append(1)
        return await orig()

    db_session.commit = spy
    return orig


async def test_create_does_not_commit_and_omits_api_key(async_client, db_session, admin_headers):
    calls: list = []
    _spy_commit(db_session, calls)
    resp = await async_client.post(
        BASE,
        json={"name": "g", "provider": "local_hybrid", "api_key": "sk-secret-123"},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    assert calls == []  # commit ở boundary, không ở service
    body = resp.json()
    assert "api_key" not in body  # Response OMIT api_key
    assert body["provider"] == "local_hybrid"


async def test_api_key_encrypted_at_rest(async_client, db_session, admin_headers):
    resp = await async_client.post(
        BASE,
        json={"name": "g", "provider": "gemini", "api_key": "sk-plain-xyz"},
        headers=admin_headers,
    )
    cid = uuid.UUID(resp.json()["id"])
    # Đọc RAW cột (bỏ qua ORM decrypt) → phải có prefix 'enc:' (không lưu plaintext).
    raw = (await db_session.execute(
        sa_text("SELECT api_key FROM extraction_extractionproviderconfig WHERE id = :id"),
        {"id": str(cid)},
    )).scalar_one()
    assert raw.startswith("enc:")
    assert "sk-plain-xyz" not in raw
    # Đọc qua ORM → giải mã đúng.
    obj = await db_session.get(ExtractionProviderConfig, cid)
    assert obj.api_key == "sk-plain-xyz"


async def test_requires_admin(async_client, auth_headers):
    resp = await async_client.post(
        BASE, json={"name": "x", "provider": "local_hybrid"}, headers=auth_headers
    )
    assert resp.status_code == 403  # non-admin bị chặn


async def test_one_default_global(async_client, db_session, admin_headers):
    r1 = await async_client.post(
        BASE, json={"name": "a", "provider": "local_hybrid", "is_default": True},
        headers=admin_headers,
    )
    r2 = await async_client.post(
        BASE, json={"name": "b", "provider": "gemini", "is_default": True},
        headers=admin_headers,
    )
    assert r1.status_code == 201 and r2.status_code == 201, (r1.text, r2.text)
    # Chỉ MỘT default toàn cục: tạo default mới → unset default cũ.
    rows = (await db_session.execute(
        sa_text("SELECT count(*) FROM extraction_extractionproviderconfig WHERE is_default = TRUE")
    )).scalar_one()
    assert rows == 1


async def test_update_invalid_provider_422(async_client, admin_headers):
    r = await async_client.post(
        BASE, json={"name": "a", "provider": "local_hybrid"}, headers=admin_headers
    )
    cid = r.json()["id"]
    resp = await async_client.patch(
        f"{BASE}/{cid}", json={"provider": "bogus"}, headers=admin_headers
    )
    assert resp.status_code == 422  # codex P2: provider không hỗ trợ bị chặn


async def test_set_default_endpoint(async_client, db_session, admin_headers):
    r = await async_client.post(
        BASE, json={"name": "a", "provider": "local_hybrid"}, headers=admin_headers
    )
    cid = r.json()["id"]
    resp = await async_client.patch(f"{BASE}/{cid}/set-default", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_default"] is True
