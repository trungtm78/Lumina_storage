"""Task 2.6 — password policy cho /auth/register.

RegisterRequest.password phải áp cùng chính sách như ChangePasswordRequest
(≥8 ký tự, có cả chữ lẫn số) — không cho tạo user với mật khẩu yếu.
"""
import uuid

import pytest


def _payload(password: str) -> dict:
    suffix = uuid.uuid4().hex[:8]
    return {
        "username": f"newuser_{suffix}",
        "email": f"new_{suffix}@example.com",
        "password": password,
        "full_name": "New User",
    }


# --- Unit: validator chung ---

def test_register_schema_rejects_weak_password():
    from pydantic import ValidationError

    from src.schemas.auth import RegisterRequest

    with pytest.raises(ValidationError):
        RegisterRequest(**_payload("short1"))  # < 8 ký tự
    with pytest.raises(ValidationError):
        RegisterRequest(**_payload("onlyletters"))  # không có số
    with pytest.raises(ValidationError):
        RegisterRequest(**_payload("12345678"))  # không có chữ
    with pytest.raises(ValidationError):
        RegisterRequest(**_payload("!!!!!!!!"))  # đủ dài nhưng không chữ không số
    with pytest.raises(ValidationError):
        RegisterRequest(**_payload("        "))  # toàn khoảng trắng
    with pytest.raises(ValidationError):
        RegisterRequest(**_payload("abcd!!!!"))  # có chữ, thiếu số


def test_register_schema_accepts_strong_password():
    from src.schemas.auth import RegisterRequest

    req = RegisterRequest(**_payload("Strong1Pass"))
    assert req.password == "Strong1Pass"


# --- Endpoint: 422 khi mật khẩu yếu (đã qua require_admin) ---

@pytest.mark.asyncio
async def test_register_endpoint_rejects_weak_password(async_client, admin_headers):
    resp = await async_client.post(
        "/api/v1/auth/register", json=_payload("weak"), headers=admin_headers
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_endpoint_accepts_strong_password(async_client, admin_headers):
    resp = await async_client.post(
        "/api/v1/auth/register", json=_payload("Strong1Pass"), headers=admin_headers
    )
    assert resp.status_code == 201
