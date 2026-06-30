"""Phase 8 B3 — ReviewService.persist_eval_pdf: contract sửa latent bug session-reuse.

Bất biến khóa: method KHÔNG tự commit + KHÔNG nuốt exception + nhận job_id (đọc lại job
trong session của mình). Nhờ vậy caller bọc `uow_context` (session RIÊNG) → background task
(start_review) + download path KHÔNG tái dùng/poison request session.
Xem [[backlog-persist-eval-pdf-session-reuse]].
"""
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from src.models.document import Document
from src.models.review import ReviewJob
from src.services.review_service import ReviewService

pytestmark = pytest.mark.asyncio


def _spy_commit(db_session, calls: list):
    orig = db_session.commit

    async def spy():
        calls.append(1)
        return await orig()

    db_session.commit = spy


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


def _mock_backend():
    backend = SimpleNamespace()
    backend.save = AsyncMock(return_value=SimpleNamespace(
        file_name="x_eval.pdf", file_path="2026/06/x_eval.pdf", file_size=10, checksum="abc",
    ))
    return backend


async def test_persist_eval_pdf_no_commit_and_persists(db_session, test_user, default_storage_config):
    """Happy path: gắn pdf_document_id + tạo Document, NHƯNG KHÔNG tự commit (uow caller owns)."""
    job = await _make_job(db_session, test_user)
    calls: list = []
    _spy_commit(db_session, calls)
    with patch("src.domain.review.review_service.get_storage_backend", return_value=_mock_backend()):
        await ReviewService(db_session).persist_eval_pdf(job.id, pdf_bytes=b"PDF")

    assert job.pdf_document_id is not None
    assert calls == []  # KHÔNG commit — boundary thuộc uow_context của caller
    pdf = (await db_session.execute(
        select(Document).where(Document.id == job.pdf_document_id)
    )).scalar_one_or_none()
    assert pdf is not None and pdf.source_type == "skill_temp"


async def test_persist_eval_pdf_propagates_error_no_swallow(db_session, test_user, default_storage_config):
    """Lỗi giữa chừng KHÔNG bị nuốt → lan tới caller (uow_context sẽ rollback session riêng)."""
    job = await _make_job(db_session, test_user)
    backend = SimpleNamespace()
    backend.save = AsyncMock(side_effect=RuntimeError("storage down"))
    with patch("src.domain.review.review_service.get_storage_backend", return_value=backend):
        with pytest.raises(RuntimeError):
            await ReviewService(db_session).persist_eval_pdf(job.id, pdf_bytes=b"PDF")


async def test_persist_eval_pdf_job_not_found_graceful(db_session, test_user):
    """job_id không tồn tại (đọc theo id trong session) → return graceful, KHÔNG raise/commit."""
    calls: list = []
    _spy_commit(db_session, calls)
    await ReviewService(db_session).persist_eval_pdf(uuid.uuid4(), pdf_bytes=b"PDF")
    assert calls == []
