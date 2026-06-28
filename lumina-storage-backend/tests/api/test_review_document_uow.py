"""Task 3.5 / T3 (domain REVIEW + DOCUMENT) — route/service CRUD KHÔNG tự commit nữa.

Gỡ commit:
- review.py route CRUD: delete_history_item / update_review_status /
  save_session_events / recalculate_score / save_version → boundary get_db.
- document.py service `_soft_delete_related_templates` (gọi GIỮA delete_document,
  trước cascade-cancel drafts → trước đây là partial-commit) → boundary get_db.

GIỮ (COMMIT CỐ Ý — KHÔNG thuộc test này):
- review.py 2901 (commit-trước fire-and-forget _persist_eval_pdf) + 2763
  (_persist_eval_pdf chạy trong asyncio background, tự commit).

Spy `db_session.commit` qua async_client (override get_db = chính db_session).
"""
import uuid

import pytest

from src.models.review import ReviewJob

pytestmark = pytest.mark.asyncio

REVIEW = "/api/v1/review"
DOCS = "/api/v1/documents"


def _spy_commit(db_session, calls: list):
    orig = db_session.commit

    async def spy():
        calls.append(1)
        return await orig()

    db_session.commit = spy
    return orig


async def _make_job(db_session, test_user) -> ReviewJob:
    job = ReviewJob(
        user_id=test_user.id,
        document_name="hopdong.docx",
        review_type="contract",
        status="reviewing",
        risk_score=10,
        report={"riskScore": 10},
    )
    db_session.add(job)
    await db_session.flush()
    return job


async def test_delete_history_route_does_not_commit(async_client, db_session, test_user, auth_headers):
    job = await _make_job(db_session, test_user)
    calls: list = []
    _spy_commit(db_session, calls)
    resp = await async_client.delete(f"{REVIEW}/history/{job.id}", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert calls == []
    assert resp.json()["status"] == "deleted"


async def test_update_status_route_does_not_commit(async_client, db_session, test_user, auth_headers):
    job = await _make_job(db_session, test_user)
    calls: list = []
    _spy_commit(db_session, calls)
    resp = await async_client.patch(
        f"{REVIEW}/history/{job.id}/status",
        json={"status": "completed"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert calls == []
    assert resp.json()["status"] == "completed"


async def test_session_events_route_does_not_commit(async_client, db_session, test_user, auth_headers):
    job = await _make_job(db_session, test_user)
    calls: list = []
    _spy_commit(db_session, calls)
    resp = await async_client.patch(
        f"{REVIEW}/jobs/{job.id}/session-events",
        json={"events": [{"id": "e1", "type": "open", "label": "Mở", "timestamp": "2026-06-28T00:00:00Z"}]},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert calls == []
    assert resp.json()["count"] == 1


async def test_review_rollback_undoes_status_change(async_client, db_session, test_user, auth_headers):
    job = await _make_job(db_session, test_user)
    jid = job.id
    await async_client.patch(
        f"{REVIEW}/history/{jid}/status",
        json={"status": "completed"},
        headers=auth_headers,
    )
    await db_session.rollback()
    # Sau rollback (không commit ở route), thay đổi status bị hoàn tác.
    refreshed = await db_session.get(ReviewJob, jid)
    assert refreshed is None or refreshed.status == "reviewing"


async def test_delete_document_route_does_not_commit(
    async_client, db_session, auth_headers, default_storage_config
):
    import io

    up = await async_client.post(
        f"{DOCS}/upload",
        files=[("files", ("d.txt", io.BytesIO(b"hello world delete me"), "text/plain"))],
        headers=auth_headers,
    )
    assert up.status_code == 201, up.text
    doc_id = up.json()[0]["id"]

    calls: list = []
    _spy_commit(db_session, calls)
    # delete_document gọi _soft_delete_related_templates (đã gỡ commit nội bộ) →
    # toàn bộ soft-delete + cascade là MỘT transaction, commit ở boundary.
    resp = await async_client.delete(f"{DOCS}/{doc_id}", headers=auth_headers)
    assert resp.status_code == 204, resp.text
    assert calls == []
    # Soft-delete thấy được trong cùng session (flush) → GET 404.
    get_resp = await async_client.get(f"{DOCS}/{doc_id}", headers=auth_headers)
    assert get_resp.status_code == 404


async def test_delete_document_rolls_back_whole_op_on_cascade_failure(
    async_client, db_session, test_user, auth_headers, default_storage_config
):
    """Bất biến Done của Phase 3: lỗi GIỮA chừng delete → rollback TOÀN BỘ (không partial).

    Trước fix, _soft_delete_related_templates tự commit GIỮA delete_document → nếu
    cascade soft_delete_drafts_by_template lỗi sau đó, doc+template đã commit = partial.
    Sau fix (chỉ flush), không commit nào trước lỗi → boundary rollback hoàn tác sạch.
    """
    from unittest.mock import patch

    from src.models.document import Document

    # Document là TEMPLATE owned by user → delete_document đi vào nhánh cascade.
    tmpl = Document(
        title="t",
        file_name="t.docx",
        original_filename="t.docx",
        file_path="/x/t.docx",
        file_size=1,
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension="docx",
        checksum="deadbeef",
        storage_config_id=default_storage_config.id,
        owner_id=test_user.id,
        source_type="template",
        source_metadata={},
    )
    db_session.add(tmpl)
    # Commit tmpl TRƯỚC (vào savepoint của fixture) để nó pre-exist; rollback sau chỉ
    # hoàn tác soft-delete chứ không xóa luôn việc tạo tmpl.
    await db_session.commit()
    tid = tmpl.id

    calls: list = []
    _spy_commit(db_session, calls)
    # Cascade lỗi GIỮA chừng (ngay sau _soft_delete_related_templates).
    with patch(
        "src.repositories.generator.GeneratorSessionRepository.soft_delete_drafts_by_template",
        side_effect=RuntimeError("boom"),
    ):
        with pytest.raises(Exception):
            await async_client.delete(f"{DOCS}/{tid}", headers=auth_headers)

    # KHÔNG commit nào xảy ra trước lỗi → không có partial-commit để lại.
    assert calls == []
    # Mô phỏng boundary get_db rollback khi request lỗi → delete bị hoàn tác sạch.
    await db_session.rollback()
    refreshed = await db_session.get(Document, tid)
    assert refreshed is not None and refreshed.deleted_at is None
