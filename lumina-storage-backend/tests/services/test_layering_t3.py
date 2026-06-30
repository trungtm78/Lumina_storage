"""Phase 6 T3 — method service mới gỡ route→repo (auth/users/storage)."""
import uuid

import pytest

from src.models.group import Group
from src.models.user import Role, User
from src.services.group import GroupService
from src.services.storage_config import StorageConfigService
from src.services.user import UserService


@pytest.mark.asyncio
async def test_get_by_id_with_permissions(db_session, test_user: User):
    svc = UserService(db_session)
    got = await svc.get_by_id_with_permissions(test_user.id)
    assert got is not None and got.id == test_user.id
    assert await svc.get_by_id_with_permissions(uuid.uuid4()) is None


@pytest.mark.asyncio
async def test_get_upload_limits_tra_dict(db_session, default_storage_config):
    svc = StorageConfigService(db_session)
    result = await svc.get_upload_limits()
    assert "max_upload_size_mb" in result
    assert isinstance(result["max_upload_size_mb"], int)


@pytest.mark.asyncio
async def test_get_upload_limits_khong_config_dung_mac_dinh(db_session):
    # Không có storage config → fallback _DEFAULT_MAX_UPLOAD_SIZE_MB.
    svc = StorageConfigService(db_session)
    result = await svc.get_upload_limits()
    assert result == {"max_upload_size_mb": 100}


@pytest.mark.asyncio
async def test_get_auto_group_by_role(db_session):
    svc = GroupService(db_session)
    role = Role(id=uuid.uuid4(), name=f"role-{uuid.uuid4().hex[:8]}")
    db_session.add(role)
    await db_session.flush()

    # Chưa có nhóm auto → None.
    assert await svc.get_auto_group_by_role(role.id) is None

    db_session.add(Group(id=uuid.uuid4(), name="g", type="auto", filter_role_id=role.id))
    await db_session.flush()
    found = await svc.get_auto_group_by_role(role.id)
    assert found is not None and found.filter_role_id == role.id
    # role_id khác → None.
    assert await svc.get_auto_group_by_role(uuid.uuid4()) is None
