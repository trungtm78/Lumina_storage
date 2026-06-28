import io

import pytest
from httpx import AsyncClient

from src.models.storage import StorageConfig
from src.models.user import User


async def test_upload_single_file(
    async_client: AsyncClient,
    auth_headers: dict,
    default_storage_config: StorageConfig,
):
    files = [("files", ("test.txt", io.BytesIO(b"hello world"), "text/plain"))]
    response = await async_client.post(
        "/api/v1/documents/upload",
        files=files,
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert len(data) == 1
    assert data[0]["original_filename"] == "test.txt"
    assert data[0]["mime_type"] == "text/plain"
    assert data[0]["file_size"] == 11
    assert data[0]["source_type"] == "upload"


async def test_upload_multiple_files(
    async_client: AsyncClient,
    auth_headers: dict,
    default_storage_config: StorageConfig,
):
    files = [
        ("files", ("file1.txt", io.BytesIO(b"content1"), "text/plain")),
        (
            "files",
            ("file2.pdf", io.BytesIO(b"%PDF-1.4\n%%EOF\n"), "application/pdf"),
        ),
    ]
    response = await async_client.post(
        "/api/v1/documents/upload",
        files=files,
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert len(data) == 2


async def test_upload_to_folder(
    async_client: AsyncClient,
    auth_headers: dict,
    default_storage_config: StorageConfig,
):
    # Create folder first
    folder_resp = await async_client.post(
        "/api/v1/folders",
        json={"name": "Upload Target"},
        headers=auth_headers,
    )
    folder_id = folder_resp.json()["id"]

    files = [("files", ("doc.txt", io.BytesIO(b"in folder"), "text/plain"))]
    response = await async_client.post(
        "/api/v1/documents/upload",
        files=files,
        data={"folder_id": folder_id},
        headers=auth_headers,
    )
    assert response.status_code == 201
    assert response.json()[0]["folder_id"] == folder_id


async def test_upload_no_storage_config(
    async_client: AsyncClient,
    auth_headers: dict,
):
    files = [("files", ("test.txt", io.BytesIO(b"data"), "text/plain"))]
    response = await async_client.post(
        "/api/v1/documents/upload",
        files=files,
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert "storage config" in response.json()["detail"].lower()


async def test_list_documents(
    async_client: AsyncClient,
    auth_headers: dict,
    default_storage_config: StorageConfig,
):
    # Upload a file
    files = [("files", ("list.txt", io.BytesIO(b"list me"), "text/plain"))]
    await async_client.post("/api/v1/documents/upload", files=files, headers=auth_headers)

    response = await async_client.get("/api/v1/documents", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1
    assert len(data["items"]) >= 1


async def test_get_document(
    async_client: AsyncClient,
    auth_headers: dict,
    default_storage_config: StorageConfig,
):
    files = [("files", ("get.txt", io.BytesIO(b"get me"), "text/plain"))]
    upload_resp = await async_client.post(
        "/api/v1/documents/upload", files=files, headers=auth_headers
    )
    doc_id = upload_resp.json()[0]["id"]

    response = await async_client.get(f"/api/v1/documents/{doc_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["id"] == doc_id


async def test_delete_document(
    async_client: AsyncClient,
    auth_headers: dict,
    default_storage_config: StorageConfig,
):
    files = [("files", ("delete.txt", io.BytesIO(b"delete me"), "text/plain"))]
    upload_resp = await async_client.post(
        "/api/v1/documents/upload", files=files, headers=auth_headers
    )
    doc_id = upload_resp.json()[0]["id"]

    response = await async_client.delete(f"/api/v1/documents/{doc_id}", headers=auth_headers)
    assert response.status_code == 204

    response = await async_client.get(f"/api/v1/documents/{doc_id}", headers=auth_headers)
    assert response.status_code == 404


async def test_upload_unauthenticated(async_client: AsyncClient):
    files = [("files", ("test.txt", io.BytesIO(b"data"), "text/plain"))]
    response = await async_client.post("/api/v1/documents/upload", files=files)
    assert response.status_code in (401, 403)
