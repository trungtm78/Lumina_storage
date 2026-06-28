"""Task 2.5 — bỏ static mount rộng /uploads (phơi document không authz).

Trước: app.mount("/uploads", StaticFiles(uploads/)) phục vụ TOÀN BỘ thư mục uploads/
— gồm cả document của user (LocalStorageBackend lưu uploads/YYYY/MM/<uuid>) — KHÔNG kiểm
quyền → IDOR/lộ dữ liệu. Sau: chỉ phục vụ branding công khai (logos/favicons); document
phải đi qua endpoint download có authz.
"""
import uuid
from pathlib import Path

import pytest

pytestmark = pytest.mark.asyncio

_UPLOADS = Path("uploads")


async def test_document_path_not_served_statically(async_client):
    """File nằm trực tiếp trong uploads/ (kiểu document) KHÔNG được phục vụ tĩnh."""
    name = f"leak_{uuid.uuid4().hex}.txt"
    target = _UPLOADS / name
    _UPLOADS.mkdir(parents=True, exist_ok=True)
    target.write_text("TOP-SECRET-DOC")
    try:
        resp = await async_client.get(f"/uploads/{name}")
        assert resp.status_code == 404
        assert "TOP-SECRET-DOC" not in resp.text
    finally:
        target.unlink(missing_ok=True)


async def test_document_subdir_path_not_served_statically(async_client):
    """Đường dẫn document thật (uploads/YYYY/MM/..) cũng 404."""
    rel = Path("2026") / "06" / f"{uuid.uuid4().hex}.txt"
    target = _UPLOADS / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("USER-DOCUMENT-BYTES")
    try:
        resp = await async_client.get(f"/uploads/{rel.as_posix()}")
        assert resp.status_code == 404
        assert "USER-DOCUMENT-BYTES" not in resp.text
    finally:
        target.unlink(missing_ok=True)


async def test_branding_logo_still_served(async_client):
    """Logo branding (công khai, hiển thị trước đăng nhập) vẫn phục vụ được."""
    name = f"brand_{uuid.uuid4().hex}.png"
    target = _UPLOADS / "logos" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"PNGDATA")
    try:
        resp = await async_client.get(f"/uploads/logos/{name}")
        assert resp.status_code == 200
        assert resp.content == b"PNGDATA"
    finally:
        target.unlink(missing_ok=True)


async def test_branding_favicon_still_served(async_client):
    name = f"fav_{uuid.uuid4().hex}.ico"
    target = _UPLOADS / "favicons" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"ICODATA")
    try:
        resp = await async_client.get(f"/uploads/favicons/{name}")
        assert resp.status_code == 200
        assert resp.content == b"ICODATA"
    finally:
        target.unlink(missing_ok=True)
