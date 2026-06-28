import pytest
from httpx import AsyncClient

from src.models.user import User
from src.models.storage import StorageConfig


async def test_create_folder(async_client: AsyncClient, auth_headers: dict, test_user: User):
    response = await async_client.post(
        "/api/v1/folders",
        json={"name": "My Folder"},
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "My Folder"
    assert data["parent_id"] is None
    assert data["owner_id"] == str(test_user.id)
    assert f"/{data['id']}" in data["path"]


async def test_create_nested_folder(async_client: AsyncClient, auth_headers: dict):
    # Create parent
    resp = await async_client.post(
        "/api/v1/folders",
        json={"name": "Parent"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    parent = resp.json()

    # Create child
    resp = await async_client.post(
        "/api/v1/folders",
        json={"name": "Child", "parent_id": parent["id"]},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    child = resp.json()
    assert child["parent_id"] == parent["id"]
    assert parent["id"] in child["path"]
    assert child["id"] in child["path"]


async def test_list_root_folders(async_client: AsyncClient, auth_headers: dict):
    # Create two folders
    await async_client.post("/api/v1/folders", json={"name": "Folder A"}, headers=auth_headers)
    await async_client.post("/api/v1/folders", json={"name": "Folder B"}, headers=auth_headers)

    resp = await async_client.get("/api/v1/folders", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 2


async def test_get_folder(async_client: AsyncClient, auth_headers: dict):
    resp = await async_client.post(
        "/api/v1/folders",
        json={"name": "Get Me"},
        headers=auth_headers,
    )
    folder_id = resp.json()["id"]

    resp = await async_client.get(f"/api/v1/folders/{folder_id}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Get Me"


async def test_delete_folder(async_client: AsyncClient, auth_headers: dict):
    resp = await async_client.post(
        "/api/v1/folders",
        json={"name": "Delete Me"},
        headers=auth_headers,
    )
    folder_id = resp.json()["id"]

    resp = await async_client.delete(f"/api/v1/folders/{folder_id}", headers=auth_headers)
    assert resp.status_code == 204

    # Should not be found after deletion
    resp = await async_client.get(f"/api/v1/folders/{folder_id}", headers=auth_headers)
    assert resp.status_code == 404


async def test_create_folder_nonexistent_parent(async_client: AsyncClient, auth_headers: dict):
    resp = await async_client.post(
        "/api/v1/folders",
        json={"name": "Orphan", "parent_id": "00000000-0000-0000-0000-000000000000"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_create_folder_unauthenticated(async_client: AsyncClient):
    resp = await async_client.post("/api/v1/folders", json={"name": "No Auth"})
    assert resp.status_code in (401, 403)
