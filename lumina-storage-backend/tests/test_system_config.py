import pytest
from httpx import AsyncClient

from src.models.user import User


async def test_create_config(async_client: AsyncClient, admin_headers: dict):
    response = await async_client.post(
        "/api/v1/system/configs",
        json={"key": "max_upload_size_mb", "value": 100, "description": "Max upload size", "is_public": True},
        headers=admin_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["key"] == "max_upload_size_mb"
    assert data["value"] == 100
    assert data["is_public"] is True


async def test_create_duplicate_key(async_client: AsyncClient, admin_headers: dict):
    await async_client.post(
        "/api/v1/system/configs",
        json={"key": "dup_key", "value": "a"},
        headers=admin_headers,
    )
    response = await async_client.post(
        "/api/v1/system/configs",
        json={"key": "dup_key", "value": "b"},
        headers=admin_headers,
    )
    assert response.status_code == 409


async def test_list_all_configs(async_client: AsyncClient, admin_headers: dict):
    await async_client.post(
        "/api/v1/system/configs",
        json={"key": "list_test", "value": "val"},
        headers=admin_headers,
    )
    response = await async_client.get("/api/v1/system/configs", headers=admin_headers)
    assert response.status_code == 200
    assert any(c["key"] == "list_test" for c in response.json())


async def test_list_public_configs(async_client: AsyncClient, admin_headers: dict):
    # Create public and private configs
    await async_client.post(
        "/api/v1/system/configs",
        json={"key": "public_cfg", "value": "visible", "is_public": True},
        headers=admin_headers,
    )
    await async_client.post(
        "/api/v1/system/configs",
        json={"key": "private_cfg", "value": "hidden", "is_public": False},
        headers=admin_headers,
    )

    # No auth required
    response = await async_client.get("/api/v1/system/configs/public")
    assert response.status_code == 200
    keys = [c["key"] for c in response.json()]
    assert "public_cfg" in keys
    assert "private_cfg" not in keys


async def test_get_config_by_key(async_client: AsyncClient, admin_headers: dict):
    await async_client.post(
        "/api/v1/system/configs",
        json={"key": "get_test", "value": 42},
        headers=admin_headers,
    )
    response = await async_client.get("/api/v1/system/configs/get_test", headers=admin_headers)
    assert response.status_code == 200
    assert response.json()["value"] == 42


async def test_get_config_not_found(async_client: AsyncClient, admin_headers: dict):
    response = await async_client.get("/api/v1/system/configs/nonexistent", headers=admin_headers)
    assert response.status_code == 404


async def test_update_config(async_client: AsyncClient, admin_headers: dict, superuser: User):
    await async_client.post(
        "/api/v1/system/configs",
        json={"key": "update_test", "value": "old"},
        headers=admin_headers,
    )
    response = await async_client.patch(
        "/api/v1/system/configs/update_test",
        json={"value": "new", "is_public": True},
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["value"] == "new"
    assert data["is_public"] is True
    assert data["updated_by_id"] == str(superuser.id)


async def test_delete_config(async_client: AsyncClient, admin_headers: dict):
    await async_client.post(
        "/api/v1/system/configs",
        json={"key": "delete_test", "value": "bye"},
        headers=admin_headers,
    )
    response = await async_client.delete("/api/v1/system/configs/delete_test", headers=admin_headers)
    assert response.status_code == 204

    response = await async_client.get("/api/v1/system/configs/delete_test", headers=admin_headers)
    assert response.status_code == 404


async def test_admin_only(async_client: AsyncClient, auth_headers: dict):
    """Regular user cannot access admin endpoints."""
    response = await async_client.get("/api/v1/system/configs", headers=auth_headers)
    assert response.status_code == 403


async def test_public_endpoint_no_auth(async_client: AsyncClient):
    """Public configs endpoint requires no authentication."""
    response = await async_client.get("/api/v1/system/configs/public")
    assert response.status_code == 200
