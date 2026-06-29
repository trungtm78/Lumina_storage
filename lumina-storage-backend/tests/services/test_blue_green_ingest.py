"""Phase 5a Task 2a — VectorService.delete_stale_versions (blue/green cleanup).

Xóa MỌI point của document_id có ingest_version != keep_version. Gọi SAU upsert V_new +
swap active → vector cũ phục vụ query tới phút chót. R8: assert ĐÚNG Filter (must
document_id + must_not ingest_version=keep), không chỉ fake behavior.
"""
import uuid

import pytest

from src.services.vector_service import VectorService


class _CaptureClient:
    def __init__(self) -> None:
        self.deleted_selector = None

    async def delete(self, collection_name, points_selector):
        self.deleted_selector = points_selector


@pytest.mark.asyncio
async def test_delete_stale_versions_builds_correct_filter():
    svc = VectorService.__new__(VectorService)
    cap = _CaptureClient()
    svc._client = cap
    svc._collection = "c"

    doc = uuid.uuid4()
    keep = "v-keep-123"
    await svc.delete_stale_versions(doc, keep_version=keep)

    f = cap.deleted_selector.filter
    must = {c.key: c for c in f.must}
    must_not = {c.key: c for c in f.must_not}
    # must document_id == doc
    assert "document_id" in must and must["document_id"].match.value == str(doc)
    # must_not ingest_version == keep (giữ version mới, xóa phần còn lại)
    assert "ingest_version" in must_not and must_not["ingest_version"].match.value == keep
