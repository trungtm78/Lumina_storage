"""Phase 7 T1 — 3 repo method thay sa_text agent.py (giữ CHÍNH XÁC semantics owner-only)."""
import uuid

import pytest

from src.models.document import Document
from src.models.user import User
from src.repositories.document import DocumentRepository
from src.repositories.system import SystemConfigRepository


async def _doc(db, owner_id, storage_id, *, title, ofn=None, ext="txt",
               source_type="upload", description=None) -> Document:
    d = Document(
        id=uuid.uuid4(), title=title, file_name=f"{title}.{ext}",
        original_filename=ofn or f"{title}.{ext}", file_path=f"{title}.{ext}",
        file_size=1, mime_type="text/plain", extension=ext, checksum="x",
        storage_config_id=storage_id, owner_id=owner_id,
        source_type=source_type, description=description,
    )
    db.add(d)
    await db.flush()
    return d


@pytest.mark.asyncio
async def test_search_workspace_files_exclude_skill_temp_only(db_session, test_user: User, default_storage_config):
    repo = DocumentRepository(db_session)
    sid = default_storage_config.id
    await _doc(db_session, test_user.id, sid, title="alpha report", source_type="upload")
    await _doc(db_session, test_user.id, sid, title="alpha tmpl", source_type="template")  # GIỮ (chỉ exclude skill_temp)
    await _doc(db_session, test_user.id, sid, title="alpha temp", source_type="skill_temp")  # LOẠI

    rows = await repo.search_workspace_files(test_user.id, "alpha")
    titles = {r.title for r in rows}
    assert "alpha report" in titles and "alpha tmpl" in titles
    assert "alpha temp" not in titles
    # ILIKE không khớp → rỗng
    assert await repo.search_workspace_files(test_user.id, "zzz") == []


@pytest.mark.asyncio
async def test_list_workspace_files_exclude_skill_temp_and_template(db_session, test_user: User, default_storage_config):
    repo = DocumentRepository(db_session)
    sid = default_storage_config.id
    await _doc(db_session, test_user.id, sid, title="w1", ext="txt", source_type="upload")
    await _doc(db_session, test_user.id, sid, title="w2", ext="docx", source_type="upload")
    await _doc(db_session, test_user.id, sid, title="t1", source_type="template")  # LOẠI
    await _doc(db_session, test_user.id, sid, title="s1", source_type="skill_temp")  # LOẠI

    rows = await repo.list_workspace_files(test_user.id)
    titles = {r.title for r in rows}
    assert titles == {"w1", "w2"}
    # extension dual-expansion: ['docx'] khớp cả ext lưu 'docx'
    ext_rows = await repo.list_workspace_files(test_user.id, extensions=["docx"])
    assert {r.title for r in ext_rows} == {"w2"}


@pytest.mark.asyncio
async def test_search_owned_templates_source_type_and_description(db_session, test_user: User, default_storage_config):
    repo = DocumentRepository(db_session)
    sid = default_storage_config.id
    await _doc(db_session, test_user.id, sid, title="hợp đồng", source_type="template",
               description="thuê nhà mặt phố")
    await _doc(db_session, test_user.id, sid, title="báo cáo", source_type="upload")  # không phải template → LOẠI

    # khớp theo description
    rows = await repo.search_owned_templates(test_user.id, "thuê nhà")
    assert len(rows) == 1 and rows[0].title == "hợp đồng"
    # chỉ template
    assert await repo.search_owned_templates(test_user.id, "báo cáo") == []


@pytest.mark.asyncio
async def test_systemconfig_get_by_key(db_session):
    from src.models.core import SystemConfig
    db_session.add(SystemConfig(key="skill_model_config", value={"x": "y"}))
    await db_session.flush()
    cfg = await SystemConfigRepository(db_session).get_by_key("skill_model_config")
    assert cfg is not None and cfg.value == {"x": "y"}
