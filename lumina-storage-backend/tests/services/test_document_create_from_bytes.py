"""Phase 7 T2 — DocumentService.create_from_bytes (write_file đi qua service + ACL)."""
import uuid

import pytest

from src.core.exceptions import NotFoundError
from src.models.user import User
from src.services.document import DocumentService


@pytest.mark.asyncio
async def test_create_from_bytes_root_owner(db_session, test_user: User, default_storage_config):
    svc = DocumentService(db_session)
    doc = await svc.create_from_bytes(
        data=b"hello world", filename="out.txt", owner=test_user,
        mime_type="text/plain", source_type="skill_generated",
    )
    assert doc.title == "out" and doc.owner_id == test_user.id
    assert doc.source_type == "skill_generated"
    # storage default được dùng (không raise) + đọc lại được
    from src.models.document import Document
    reloaded = await db_session.get(Document, doc.id)
    assert reloaded is not None and reloaded.extension == ".txt"


@pytest.mark.asyncio
async def test_create_from_bytes_folder_not_found_raises(db_session, test_user: User, default_storage_config):
    svc = DocumentService(db_session)
    with pytest.raises(NotFoundError):
        await svc.create_from_bytes(
            data=b"x", filename="a.txt", owner=test_user,
            folder_id=uuid.uuid4(),  # folder không tồn tại → nhánh ACL
        )
