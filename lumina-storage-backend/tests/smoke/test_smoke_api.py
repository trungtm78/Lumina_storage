"""Smoke test E2E — đèn xanh tổng cho mọi phase refactor.

Kiểm tra nhanh các luồng cốt lõi vẫn sống: health liveness + chuỗi xác thực
(token → /auth/me trả đúng user). Chạy mọi phase để bắt regression sớm.
"""
import pytest

pytestmark = pytest.mark.asyncio


async def test_health_liveness(async_client):
    r = await async_client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_auth_me_with_token(async_client, superuser, admin_headers):
    r = await async_client.get("/api/v1/auth/me", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == str(superuser.id)
    assert body["username"] == superuser.username
