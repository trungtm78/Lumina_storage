"""Chống IDOR template (review SEC-P1 + /codex outside-voice).

MỌI truy cập template theo user-supplied id (read/generate/extract/batch/update/upload/rescan +
session-create + session manual-edit) PHẢI verify quyền của user. Denial/missing đều trả 404
"Template not found" — KHÔNG leak tồn tại, tránh 403-vs-404 existence oracle.

Honor ACL share (qua DocumentPermissionService.check_permission) — y hệt pattern document_to_template
đã đúng. Gộp 1 chỗ (DRY) để không còn handler nào quên check.
"""
import uuid

from fastapi import HTTPException

from src.core.exceptions import ForbiddenError, NotFoundError
from src.models.document import Document
from src.shared.document_permission import DocumentPermissionService


async def assert_template_permission(db, user, document_id: uuid.UUID, required: str = "viewer") -> None:
    """check_permission + dịch Forbidden/NotFound → 404 (no existence oracle)."""
    try:
        await DocumentPermissionService(db).check_permission(
            user, document_id=document_id, required=required
        )
    except (ForbiddenError, NotFoundError):
        raise HTTPException(404, "Template not found")


async def load_template_checked(db, user, template_id: uuid.UUID, required: str = "viewer") -> Document:
    """Load template (source_type=='template', chưa xóa) + verify quyền. Mọi denial → 404.

    required='viewer' cho read/generate/extract; 'editor' cho update/upload/rescan.
    """
    template_doc = await db.get(Document, template_id)
    if not template_doc or template_doc.source_type != "template" or template_doc.deleted_at is not None:
        raise HTTPException(404, "Template not found")
    await assert_template_permission(db, user, template_doc.id, required)
    return template_doc
