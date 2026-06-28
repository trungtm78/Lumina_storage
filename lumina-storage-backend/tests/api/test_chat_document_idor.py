"""Test IDOR document_ids: chat chỉ dùng document mà user có quyền viewer."""
import uuid

import pytest

from src.core.config import get_settings
from src.models.document import Document
from src.services.chat_service import ChatService

pytestmark = pytest.mark.asyncio


async def _make_doc(db, owner_id, storage_config_id):
    doc = Document(
        id=uuid.uuid4(),
        title="d.txt",
        file_name=f"{uuid.uuid4()}.txt",
        original_filename="d.txt",
        file_path="/tmp/lumina-test-uploads/d.txt",
        file_size=1,
        mime_type="text/plain",
        extension="txt",
        checksum="x",
        folder_id=None,
        storage_config_id=storage_config_id,
        owner_id=owner_id,
        source_type="upload",
    )
    db.add(doc)
    await db.flush()
    return doc


async def test_filter_drops_unauthorized_document(db_session, test_user, superuser, default_storage_config):
    # roles eager-load như get_current_user làm ở production (tránh lazy MissingGreenlet)
    await db_session.refresh(test_user, attribute_names=["roles"])
    doc = await _make_doc(db_session, superuser.id, default_storage_config.id)  # của superuser
    svc = ChatService(db=db_session, settings=get_settings())
    # test_user (non-admin, không quyền) → bị loại
    assert await svc._filter_permitted_documents(test_user, [doc.id]) == []


async def test_owner_keeps_own_document(db_session, test_user, default_storage_config):
    await db_session.refresh(test_user, attribute_names=["roles"])
    doc = await _make_doc(db_session, test_user.id, default_storage_config.id)
    svc = ChatService(db=db_session, settings=get_settings())
    assert await svc._filter_permitted_documents(test_user, [doc.id]) == [doc.id]


async def test_filter_passthrough_none():
    svc = ChatService(db=None, settings=get_settings())
    assert await svc._filter_permitted_documents(None, None) is None


async def test_skillcontext_denies_unauthorized_document(db_session, test_user, superuser, default_storage_config):
    """Skill script (agent) không được đọc doc ngoài quyền của user."""
    from src.core.exceptions import ForbiddenError, NotFoundError
    from src.services.skill_service import SkillContext

    await db_session.refresh(test_user, attribute_names=["roles"])
    doc = await _make_doc(db_session, superuser.id, default_storage_config.id)  # của superuser
    ctx = SkillContext(db=db_session, settings=get_settings(), user=test_user)
    with pytest.raises((ForbiddenError, NotFoundError)):
        await ctx.get_document_bytes(str(doc.id))
