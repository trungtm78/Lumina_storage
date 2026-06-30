"""Phase 6 T2 — GeneratorService bọc GeneratorSession*Repository (gỡ route→repo).

Service delegate 1-1 sang repo (không commit — boundary get_db). Test happy-path mỗi method.
"""
import uuid

import pytest

from src.models.user import User
from src.services.generator_service import GeneratorService


@pytest.mark.asyncio
async def test_create_get_update_delete_session(db_session, test_user: User):
    svc = GeneratorService(db_session)
    session = await svc.create_session({
        "user_id": test_user.id,
        "doc_type": "report",
        "field_values": {"a": 1},
        "title": "T",
        "status": "draft",
    })
    sid = session.id

    got = await svc.get_session_for_user(sid, test_user.id)
    assert got is not None and got.title == "T"
    # user khác không thấy
    assert await svc.get_session_for_user(sid, uuid.uuid4()) is None

    updated = await svc.update_session(sid, {"title": "T2"})
    assert updated.title == "T2"

    items, total = await svc.list_sessions_for_user(test_user.id)
    assert total >= 1 and any(s.id == sid for s in items)

    await svc.delete_session(sid)
    assert await svc.get_session_for_user(sid, test_user.id) is None


async def _make_template_doc(db_session, test_user, storage_config) -> uuid.UUID:
    """Document tối thiểu làm template (template_id là FK → documents_document)."""
    from src.models.document import Document
    doc = Document(
        id=uuid.uuid4(), title="tmpl", file_name="t.docx", original_filename="t.docx",
        file_path="t.docx", file_size=1, mime_type="application/octet-stream",
        extension="docx", checksum="x", storage_config_id=storage_config.id,
        owner_id=test_user.id,
    )
    db_session.add(doc)
    await db_session.flush()
    return doc.id


@pytest.mark.asyncio
async def test_count_drafts_by_template(db_session, test_user: User, default_storage_config):
    svc = GeneratorService(db_session)
    template_id = await _make_template_doc(db_session, test_user, default_storage_config)
    await svc.create_session({
        "user_id": test_user.id, "template_id": template_id,
        "doc_type": "report", "status": "draft",
    })
    assert await svc.count_drafts_by_template(template_id) == 1
    assert await svc.count_drafts_by_template(uuid.uuid4()) == 0


@pytest.mark.asyncio
async def test_version_lifecycle(db_session, test_user: User):
    svc = GeneratorService(db_session)
    session = await svc.create_session({
        "user_id": test_user.id, "doc_type": "report", "status": "draft",
    })
    sid = session.id

    assert await svc.next_version_no(sid) == 1
    v1 = await svc.create_version({
        "session_id": sid, "version_no": 1, "label": "V1",
        "edited_html": "<p>x</p>", "field_values": {},
    })
    assert await svc.next_version_no(sid) == 2

    got = await svc.get_version_for_session(v1.id, sid)
    assert got is not None and got.label == "V1"

    renamed = await svc.update_version(v1.id, {"label": "V1-renamed"})
    assert renamed.label == "V1-renamed"

    items, total = await svc.list_versions_for_session(sid)
    assert total == 1 and items[0].id == v1.id

    await svc.delete_version(v1.id)
    assert await svc.get_version_for_session(v1.id, sid) is None
