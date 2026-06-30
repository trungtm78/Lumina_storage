"""Test IDOR template (generator): user B KHÔNG được dùng template của user A.

Trước fix: các route generator chỉ check source_type=='template', KHÔNG check ownership
→ user A gửi template_id của B (lộ trong response draft/document-to-template) để render/
generate/extract/batch nội dung template riêng của B (review SEC-P1, EXPLOITABLE).

Fix:
- execute_generate (core /generate + /sessions/generate): strict owner check → 404.
- 5 handler standalone (render-pdf/map-columns/batch/extract-from-file/extract-from-text):
  DocumentPermissionService.check_permission(required="viewer") → 403 (honor ACL share).
"""
import io
import uuid

import pytest

from src.models.document import Document

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/generator"


async def _make_template(db, owner_id, storage_config_id):
    tmpl = Document(
        id=uuid.uuid4(),
        title="secret_template.docx",
        file_name=f"{uuid.uuid4()}.docx",
        original_filename="secret_template.docx",
        file_path="/tmp/lumina-test-uploads/secret_template.docx",
        file_size=1,
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension="docx",
        checksum="x",
        folder_id=None,
        storage_config_id=storage_config_id,
        owner_id=owner_id,
        source_type="template",
        source_metadata={"template_fields": [{"name": "field1", "label": "Field 1"}]},
    )
    db.add(tmpl)
    await db.flush()
    return tmpl


def _tiny_xlsx() -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["field1"])
    ws.append(["value1"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def test_generate_other_users_template_blocked(
    async_client, db_session, superuser, default_storage_config, auth_headers
):
    """POST /generate với template của superuser, gọi bằng test_user → 404 (owner-only)."""
    tmpl = await _make_template(db_session, superuser.id, default_storage_config.id)
    r = await async_client.post(
        f"{BASE}/generate",
        json={"template_id": str(tmpl.id), "field_values": {"field1": "x"}},
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text


async def test_render_pdf_other_users_template_blocked(
    async_client, db_session, superuser, default_storage_config, auth_headers
):
    tmpl = await _make_template(db_session, superuser.id, default_storage_config.id)
    r = await async_client.post(
        f"{BASE}/render-pdf",
        json={"template_id": str(tmpl.id), "field_values": {"field1": "x"}},
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text  # denial → 404 (no 403-vs-404 oracle)


async def test_extract_from_text_other_users_template_blocked(
    async_client, db_session, superuser, default_storage_config, auth_headers
):
    tmpl = await _make_template(db_session, superuser.id, default_storage_config.id)
    r = await async_client.post(
        f"{BASE}/extract-from-text",
        json={"template_id": str(tmpl.id), "text": "some text"},
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text


async def test_batch_other_users_template_blocked(
    async_client, db_session, superuser, default_storage_config, auth_headers
):
    """Batch export = rò rỉ NHIỀU NHẤT (render toàn bộ rows) → phải chặn."""
    tmpl = await _make_template(db_session, superuser.id, default_storage_config.id)
    r = await async_client.post(
        f"{BASE}/batch",
        data={"template_id": str(tmpl.id), "column_mapping": "{}"},
        files={"file": ("data.xlsx", _tiny_xlsx(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text


async def test_map_columns_other_users_template_blocked(
    async_client, db_session, superuser, default_storage_config, auth_headers
):
    tmpl = await _make_template(db_session, superuser.id, default_storage_config.id)
    r = await async_client.post(
        f"{BASE}/map-columns",
        data={"template_id": str(tmpl.id), "instruction": ""},
        files={"file": ("data.xlsx", _tiny_xlsx(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text


# ── templates_routes.py (read/write IDOR — /codex bắt) ─────────────────────────

async def test_get_template_other_user_blocked(
    async_client, db_session, superuser, default_storage_config, auth_headers
):
    tmpl = await _make_template(db_session, superuser.id, default_storage_config.id)
    r = await async_client.get(f"/api/v1/templates/{tmpl.id}", headers=auth_headers)
    assert r.status_code == 404, r.text


async def test_update_template_other_user_blocked(
    async_client, db_session, superuser, default_storage_config, auth_headers
):
    tmpl = await _make_template(db_session, superuser.id, default_storage_config.id)
    r = await async_client.patch(
        f"/api/v1/templates/{tmpl.id}",
        json={"description": "hijacked"},
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text


async def test_rescan_template_other_user_blocked(
    async_client, db_session, superuser, default_storage_config, auth_headers
):
    tmpl = await _make_template(db_session, superuser.id, default_storage_config.id)
    r = await async_client.post(f"/api/v1/templates/{tmpl.id}/rescan", headers=auth_headers)
    assert r.status_code == 404, r.text


async def test_create_session_with_other_users_template_blocked(
    async_client, db_session, superuser, default_storage_config, auth_headers
):
    """Session-create gắn template của B → mọi /generate sau dùng nó → chặn NGAY khi tạo."""
    tmpl = await _make_template(db_session, superuser.id, default_storage_config.id)
    r = await async_client.post(
        f"{BASE}/sessions",
        json={"doc_type": "test", "title": "x", "template_id": str(tmpl.id)},
        headers=auth_headers,
    )
    assert r.status_code == 404, r.text


async def test_owner_can_update_own_template(
    async_client, db_session, test_user, default_storage_config, auth_headers
):
    """Chủ template update được (không bị chặn nhầm)."""
    tmpl = await _make_template(db_session, test_user.id, default_storage_config.id)
    r = await async_client.patch(
        f"/api/v1/templates/{tmpl.id}",
        json={"description": "my own edit"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["description"] == "my own edit"


async def test_owner_passes_permission_gate(
    async_client, db_session, test_user, default_storage_config, auth_headers
):
    """Chủ template (test_user) QUA được gate quyền → chạm tới storage read.

    Chứng minh fix KHÔNG chặn nhầm chủ sở hữu: owner vượt permission check rồi
    fail ở storage (file test không tồn tại) — tức gate đã CHO QUA, không trả 403/404.
    """
    tmpl = await _make_template(db_session, test_user.id, default_storage_config.id)
    with pytest.raises(FileNotFoundError):
        await async_client.post(
            f"{BASE}/render-pdf",
            json={"template_id": str(tmpl.id), "field_values": {"field1": "x"}},
            headers=auth_headers,
        )
