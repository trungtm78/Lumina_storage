"""Tests for document and folder ACL (permission management)."""
import io
import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.security import create_access_token, hash_password
from src.models.document import Document, DocumentPermission, Folder
from src.models.group import Group
from src.models.storage import StorageConfig
from src.models.user import Role, User, UserRole


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def other_user(db_session: AsyncSession) -> User:
    """A second regular user who does NOT own the test documents."""
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=uuid.uuid4(),
        username=f"otheruser_{suffix}",
        email=f"other_{suffix}@example.com",
        full_name="Other User",
        password=hash_password("password123"),
        is_active=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture
def other_headers(other_user: User) -> dict[str, str]:
    token = create_access_token({"sub": str(other_user.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def role(db_session: AsyncSession) -> Role:
    r = Role(id=uuid.uuid4(), name=f"testrole_{uuid.uuid4().hex[:8]}", description="Test role")
    db_session.add(r)
    await db_session.flush()
    return r


@pytest_asyncio.fixture
async def group(db_session: AsyncSession, role: Role) -> Group:
    g = Group(
        id=uuid.uuid4(),
        name=f"testgroup_{uuid.uuid4().hex[:8]}",
        description="Test group",
        type="auto",
        filter_role_id=role.id,
    )
    db_session.add(g)
    await db_session.flush()
    return g


@pytest_asyncio.fixture
async def other_role(db_session: AsyncSession) -> Role:
    r = Role(id=uuid.uuid4(), name=f"otherrole_{uuid.uuid4().hex[:8]}", description="Other role")
    db_session.add(r)
    await db_session.flush()
    return r


@pytest_asyncio.fixture
async def other_group(db_session: AsyncSession, other_role: Role) -> Group:
    g = Group(
        id=uuid.uuid4(),
        name=f"othergroup_{uuid.uuid4().hex[:8]}",
        description="Other group",
        type="auto",
        filter_role_id=other_role.id,
    )
    db_session.add(g)
    await db_session.flush()
    return g


@pytest_asyncio.fixture
async def other_user_with_role(
    db_session: AsyncSession, other_user: User, role: Role
) -> User:
    """other_user added to role, with relationship loaded."""
    membership = UserRole(
        user_id=other_user.id, role_id=role.id, added_by_id=None
    )
    db_session.add(membership)
    await db_session.flush()
    await db_session.refresh(other_user, attribute_names=["roles"])
    return other_user


@pytest_asyncio.fixture
async def owned_folder(
    db_session: AsyncSession, test_user: User
) -> Folder:
    """A folder owned by test_user."""
    folder = Folder(
        id=uuid.uuid4(),
        name="Test Folder",
        parent_id=None,
        owner_id=test_user.id,
    )
    folder.path = f"/{folder.id}"
    db_session.add(folder)
    await db_session.flush()
    return folder


@pytest_asyncio.fixture
async def owned_subfolder(
    db_session: AsyncSession, test_user: User, owned_folder: Folder
) -> Folder:
    """A subfolder under owned_folder, also owned by test_user."""
    subfolder = Folder(
        id=uuid.uuid4(),
        name="Sub Folder",
        parent_id=owned_folder.id,
        owner_id=test_user.id,
    )
    subfolder.path = f"{owned_folder.path}/{subfolder.id}"
    db_session.add(subfolder)
    await db_session.flush()
    return subfolder


@pytest_asyncio.fixture
async def owned_document(
    db_session: AsyncSession,
    test_user: User,
    owned_folder: Folder,
    default_storage_config: StorageConfig,
) -> Document:
    """A document owned by test_user in owned_folder."""
    doc = Document(
        id=uuid.uuid4(),
        title="test.txt",
        description=None,
        file_name=f"{uuid.uuid4()}.txt",
        original_filename="test.txt",
        file_path="/tmp/lumina-test-uploads/test.txt",
        file_size=11,
        mime_type="text/plain",
        extension="txt",
        checksum="abc123",
        folder_id=owned_folder.id,
        storage_config_id=default_storage_config.id,
        owner_id=test_user.id,
        source_type="upload",
    )
    db_session.add(doc)
    await db_session.flush()
    return doc


@pytest_asyncio.fixture
async def subfolder_document(
    db_session: AsyncSession,
    test_user: User,
    owned_subfolder: Folder,
    default_storage_config: StorageConfig,
) -> Document:
    """A document in the subfolder, owned by test_user."""
    doc = Document(
        id=uuid.uuid4(),
        title="sub.txt",
        description=None,
        file_name=f"{uuid.uuid4()}.txt",
        original_filename="sub.txt",
        file_path="/tmp/lumina-test-uploads/sub.txt",
        file_size=7,
        mime_type="text/plain",
        extension="txt",
        checksum="def456",
        folder_id=owned_subfolder.id,
        storage_config_id=default_storage_config.id,
        owner_id=test_user.id,
        source_type="upload",
    )
    db_session.add(doc)
    await db_session.flush()
    return doc


# ── Document Permission CRUD ────────────────────────────────────────────────


async def test_share_document_as_owner(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_document: Document,
    group: Group,
):
    """Owner (manager) can share document with a role."""
    resp = await async_client.post(
        f"/api/v1/documents/{owned_document.id}/permissions",
        json={"group_id": str(group.id), "permission": "viewer"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["document_id"] == str(owned_document.id)
    assert data["group_id"] == str(group.id)
    assert data["permission"] == "viewer"


async def test_share_document_duplicate_role(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_document: Document,
    group: Group,
):
    """Sharing a document with the same role twice returns 409."""
    await async_client.post(
        f"/api/v1/documents/{owned_document.id}/permissions",
        json={"group_id": str(group.id), "permission": "viewer"},
        headers=auth_headers,
    )
    resp = await async_client.post(
        f"/api/v1/documents/{owned_document.id}/permissions",
        json={"group_id": str(group.id), "permission": "editor"},
        headers=auth_headers,
    )
    assert resp.status_code == 409


async def test_share_document_invalid_permission_level(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_document: Document,
    group: Group,
):
    """Invalid permission string returns 400."""
    resp = await async_client.post(
        f"/api/v1/documents/{owned_document.id}/permissions",
        json={"group_id": str(group.id), "permission": "admin"},
        headers=auth_headers,
    )
    assert resp.status_code == 400


async def test_share_document_nonexistent_role(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_document: Document,
):
    """Sharing with a non-existent role returns 404."""
    resp = await async_client.post(
        f"/api/v1/documents/{owned_document.id}/permissions",
        json={"group_id": str(uuid.uuid4()), "permission": "viewer"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_share_document_forbidden_for_non_manager(
    async_client: AsyncClient,
    other_headers: dict,
    owned_document: Document,
    group: Group,
    other_user_with_role: User,
    db_session: AsyncSession,
):
    """User with viewer permission cannot share the document."""
    # Give other_user viewer permission via their role
    perm = DocumentPermission(
        id=uuid.uuid4(),
        document_id=owned_document.id,
        group_id=group.id,
        permission="viewer",
        created_by_id=owned_document.owner_id,
    )
    db_session.add(perm)
    await db_session.flush()

    resp = await async_client.post(
        f"/api/v1/documents/{owned_document.id}/permissions",
        json={"group_id": str(group.id), "permission": "editor"},
        headers=other_headers,
    )
    assert resp.status_code == 403


async def test_list_document_permissions(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_document: Document,
    group: Group,
):
    """Owner can list all permissions on a document."""
    # Share first
    await async_client.post(
        f"/api/v1/documents/{owned_document.id}/permissions",
        json={"group_id": str(group.id), "permission": "editor"},
        headers=auth_headers,
    )

    resp = await async_client.get(
        f"/api/v1/documents/{owned_document.id}/permissions",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["permission"] == "editor"


async def test_list_document_permissions_forbidden_for_stranger(
    async_client: AsyncClient,
    other_headers: dict,
    owned_document: Document,
    other_user: User,
):
    """User with no permission cannot list permissions."""
    resp = await async_client.get(
        f"/api/v1/documents/{owned_document.id}/permissions",
        headers=other_headers,
    )
    assert resp.status_code == 403


async def test_update_document_permission(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_document: Document,
    group: Group,
):
    """Owner can update an existing permission level."""
    create_resp = await async_client.post(
        f"/api/v1/documents/{owned_document.id}/permissions",
        json={"group_id": str(group.id), "permission": "viewer"},
        headers=auth_headers,
    )
    perm_id = create_resp.json()["id"]

    resp = await async_client.patch(
        f"/api/v1/documents/{owned_document.id}/permissions/{perm_id}",
        json={"permission": "manager"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["permission"] == "manager"


async def test_revoke_document_permission(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_document: Document,
    group: Group,
):
    """Owner can revoke a permission."""
    create_resp = await async_client.post(
        f"/api/v1/documents/{owned_document.id}/permissions",
        json={"group_id": str(group.id), "permission": "viewer"},
        headers=auth_headers,
    )
    perm_id = create_resp.json()["id"]

    resp = await async_client.delete(
        f"/api/v1/documents/{owned_document.id}/permissions/{perm_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 204

    # Verify it's gone
    list_resp = await async_client.get(
        f"/api/v1/documents/{owned_document.id}/permissions",
        headers=auth_headers,
    )
    assert len(list_resp.json()) == 0


# ── Folder Permission CRUD ──────────────────────────────────────────────────


async def test_share_folder_as_owner(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_folder: Folder,
    group: Group,
):
    resp = await async_client.post(
        f"/api/v1/folders/{owned_folder.id}/permissions",
        json={"group_id": str(group.id), "permission": "editor"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["folder_id"] == str(owned_folder.id)
    assert data["permission"] == "editor"


async def test_share_folder_duplicate_role(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_folder: Folder,
    group: Group,
):
    await async_client.post(
        f"/api/v1/folders/{owned_folder.id}/permissions",
        json={"group_id": str(group.id), "permission": "viewer"},
        headers=auth_headers,
    )
    resp = await async_client.post(
        f"/api/v1/folders/{owned_folder.id}/permissions",
        json={"group_id": str(group.id), "permission": "editor"},
        headers=auth_headers,
    )
    assert resp.status_code == 409


async def test_list_folder_permissions(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_folder: Folder,
    group: Group,
):
    await async_client.post(
        f"/api/v1/folders/{owned_folder.id}/permissions",
        json={"group_id": str(group.id), "permission": "viewer"},
        headers=auth_headers,
    )
    resp = await async_client.get(
        f"/api/v1/folders/{owned_folder.id}/permissions",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_update_folder_permission(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_folder: Folder,
    group: Group,
):
    create_resp = await async_client.post(
        f"/api/v1/folders/{owned_folder.id}/permissions",
        json={"group_id": str(group.id), "permission": "viewer"},
        headers=auth_headers,
    )
    perm_id = create_resp.json()["id"]

    resp = await async_client.patch(
        f"/api/v1/folders/{owned_folder.id}/permissions/{perm_id}",
        json={"permission": "editor"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["permission"] == "editor"


async def test_revoke_folder_permission(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_folder: Folder,
    group: Group,
):
    create_resp = await async_client.post(
        f"/api/v1/folders/{owned_folder.id}/permissions",
        json={"group_id": str(group.id), "permission": "viewer"},
        headers=auth_headers,
    )
    perm_id = create_resp.json()["id"]

    resp = await async_client.delete(
        f"/api/v1/folders/{owned_folder.id}/permissions/{perm_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 204


# ── Permission Enforcement on Document Operations ───────────────────────────


async def test_get_document_as_viewer(
    async_client: AsyncClient,
    other_headers: dict,
    owned_document: Document,
    group: Group,
    other_user_with_role: User,
    db_session: AsyncSession,
):
    """User with viewer permission can read the document."""
    perm = DocumentPermission(
        id=uuid.uuid4(),
        document_id=owned_document.id,
        group_id=group.id,
        permission="viewer",
        created_by_id=owned_document.owner_id,
    )
    db_session.add(perm)
    await db_session.flush()

    resp = await async_client.get(
        f"/api/v1/documents/{owned_document.id}",
        headers=other_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == str(owned_document.id)


async def test_get_document_forbidden_without_permission(
    async_client: AsyncClient,
    other_headers: dict,
    owned_document: Document,
    other_user: User,
):
    """User without any permission cannot read the document."""
    resp = await async_client.get(
        f"/api/v1/documents/{owned_document.id}",
        headers=other_headers,
    )
    assert resp.status_code == 403


async def test_delete_document_as_manager(
    async_client: AsyncClient,
    other_headers: dict,
    owned_document: Document,
    group: Group,
    other_user_with_role: User,
    db_session: AsyncSession,
):
    """User with manager permission can delete."""
    perm = DocumentPermission(
        id=uuid.uuid4(),
        document_id=owned_document.id,
        group_id=group.id,
        permission="manager",
        created_by_id=owned_document.owner_id,
    )
    db_session.add(perm)
    await db_session.flush()

    resp = await async_client.delete(
        f"/api/v1/documents/{owned_document.id}",
        headers=other_headers,
    )
    assert resp.status_code == 204


async def test_delete_document_forbidden_for_editor(
    async_client: AsyncClient,
    other_headers: dict,
    owned_document: Document,
    group: Group,
    other_user_with_role: User,
    db_session: AsyncSession,
):
    """User with editor permission cannot delete (requires manager)."""
    perm = DocumentPermission(
        id=uuid.uuid4(),
        document_id=owned_document.id,
        group_id=group.id,
        permission="editor",
        created_by_id=owned_document.owner_id,
    )
    db_session.add(perm)
    await db_session.flush()

    resp = await async_client.delete(
        f"/api/v1/documents/{owned_document.id}",
        headers=other_headers,
    )
    assert resp.status_code == 403


async def test_delete_folder_forbidden_for_viewer(
    async_client: AsyncClient,
    other_headers: dict,
    owned_folder: Folder,
    group: Group,
    other_user_with_role: User,
    db_session: AsyncSession,
):
    """Viewer on folder cannot delete it."""
    perm = DocumentPermission(
        id=uuid.uuid4(),
        folder_id=owned_folder.id,
        group_id=group.id,
        permission="viewer",
        created_by_id=owned_folder.owner_id,
    )
    db_session.add(perm)
    await db_session.flush()

    resp = await async_client.delete(
        f"/api/v1/folders/{owned_folder.id}",
        headers=other_headers,
    )
    assert resp.status_code == 403


# ── Superuser Bypass ─────────────────────────────────────────────────────────


async def test_superuser_can_read_any_document(
    async_client: AsyncClient,
    admin_headers: dict,
    owned_document: Document,
    superuser: User,
):
    """Superuser can access any document regardless of ACL."""
    resp = await async_client.get(
        f"/api/v1/documents/{owned_document.id}",
        headers=admin_headers,
    )
    assert resp.status_code == 200


async def test_superuser_can_share_any_document(
    async_client: AsyncClient,
    admin_headers: dict,
    owned_document: Document,
    group: Group,
    superuser: User,
):
    """Superuser can share any document."""
    resp = await async_client.post(
        f"/api/v1/documents/{owned_document.id}/permissions",
        json={"group_id": str(group.id), "permission": "viewer"},
        headers=admin_headers,
    )
    assert resp.status_code == 201


async def test_superuser_can_delete_any_document(
    async_client: AsyncClient,
    admin_headers: dict,
    owned_document: Document,
    superuser: User,
):
    resp = await async_client.delete(
        f"/api/v1/documents/{owned_document.id}",
        headers=admin_headers,
    )
    assert resp.status_code == 204


# ── Folder Permission Inheritance ────────────────────────────────────────────


async def test_folder_permission_grants_document_access(
    async_client: AsyncClient,
    other_headers: dict,
    owned_document: Document,
    owned_folder: Folder,
    group: Group,
    other_user_with_role: User,
    db_session: AsyncSession,
):
    """Viewer permission on folder grants viewer access to documents in it."""
    perm = DocumentPermission(
        id=uuid.uuid4(),
        folder_id=owned_folder.id,
        group_id=group.id,
        permission="viewer",
        created_by_id=owned_folder.owner_id,
    )
    db_session.add(perm)
    await db_session.flush()

    resp = await async_client.get(
        f"/api/v1/documents/{owned_document.id}",
        headers=other_headers,
    )
    assert resp.status_code == 200


async def test_parent_folder_permission_inherits_to_subfolder_document(
    async_client: AsyncClient,
    other_headers: dict,
    subfolder_document: Document,
    owned_folder: Folder,
    owned_subfolder: Folder,
    group: Group,
    other_user_with_role: User,
    db_session: AsyncSession,
):
    """Permission on parent folder inherits to documents in subfolder."""
    perm = DocumentPermission(
        id=uuid.uuid4(),
        folder_id=owned_folder.id,
        group_id=group.id,
        permission="viewer",
        created_by_id=owned_folder.owner_id,
    )
    db_session.add(perm)
    await db_session.flush()

    resp = await async_client.get(
        f"/api/v1/documents/{subfolder_document.id}",
        headers=other_headers,
    )
    assert resp.status_code == 200


async def test_subfolder_permission_does_not_grant_parent_access(
    async_client: AsyncClient,
    other_headers: dict,
    owned_document: Document,
    owned_subfolder: Folder,
    group: Group,
    other_user_with_role: User,
    db_session: AsyncSession,
):
    """Permission on subfolder does NOT grant access to documents in parent folder."""
    perm = DocumentPermission(
        id=uuid.uuid4(),
        folder_id=owned_subfolder.id,
        group_id=group.id,
        permission="viewer",
        created_by_id=owned_subfolder.owner_id,
    )
    db_session.add(perm)
    await db_session.flush()

    resp = await async_client.get(
        f"/api/v1/documents/{owned_document.id}",
        headers=other_headers,
    )
    assert resp.status_code == 403


async def test_highest_permission_wins(
    async_client: AsyncClient,
    auth_headers: dict,
    other_headers: dict,
    owned_document: Document,
    owned_folder: Folder,
    group: Group,
    other_role: Role,
    other_group: Group,
    other_user_with_role: User,
    db_session: AsyncSession,
):
    """When a user has multiple roles with different permissions, highest wins."""
    # Also add other_user to other_role
    membership2 = UserRole(
        user_id=other_user_with_role.id, role_id=other_role.id, added_by_id=None
    )
    db_session.add(membership2)
    await db_session.flush()
    await db_session.refresh(other_user_with_role, attribute_names=["roles"])

    # role gets viewer on document
    perm1 = DocumentPermission(
        id=uuid.uuid4(),
        document_id=owned_document.id,
        group_id=group.id,
        permission="viewer",
        created_by_id=owned_document.owner_id,
    )
    # other_role gets manager on folder (inherited)
    perm2 = DocumentPermission(
        id=uuid.uuid4(),
        folder_id=owned_folder.id,
        group_id=other_group.id,
        permission="manager",
        created_by_id=owned_folder.owner_id,
    )
    db_session.add_all([perm1, perm2])
    await db_session.flush()

    # Should be able to delete (requires manager) because highest wins
    resp = await async_client.delete(
        f"/api/v1/documents/{owned_document.id}",
        headers=other_headers,
    )
    assert resp.status_code == 204


# ── Edge Cases ───────────────────────────────────────────────────────────────


async def test_share_nonexistent_document(
    async_client: AsyncClient,
    auth_headers: dict,
    group: Group,
):
    """Sharing a non-existent document returns 404."""
    fake_id = uuid.uuid4()
    resp = await async_client.post(
        f"/api/v1/documents/{fake_id}/permissions",
        json={"group_id": str(group.id), "permission": "viewer"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_share_nonexistent_folder(
    async_client: AsyncClient,
    auth_headers: dict,
    group: Group,
):
    """Sharing a non-existent folder returns 404."""
    fake_id = uuid.uuid4()
    resp = await async_client.post(
        f"/api/v1/folders/{fake_id}/permissions",
        json={"group_id": str(group.id), "permission": "viewer"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_update_nonexistent_permission(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_document: Document,
):
    """Updating a non-existent permission returns 404."""
    fake_perm_id = uuid.uuid4()
    resp = await async_client.patch(
        f"/api/v1/documents/{owned_document.id}/permissions/{fake_perm_id}",
        json={"permission": "editor"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_revoke_nonexistent_permission(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_document: Document,
):
    """Revoking a non-existent permission returns 404."""
    fake_perm_id = uuid.uuid4()
    resp = await async_client.delete(
        f"/api/v1/documents/{owned_document.id}/permissions/{fake_perm_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_unauthenticated_cannot_access_permissions(
    async_client: AsyncClient,
    owned_document: Document,
):
    """Unauthenticated request returns 401/403."""
    resp = await async_client.get(
        f"/api/v1/documents/{owned_document.id}/permissions",
    )
    assert resp.status_code in (401, 403)


async def test_user_without_roles_has_no_access(
    async_client: AsyncClient,
    other_headers: dict,
    owned_document: Document,
    other_user: User,
):
    """A user with no roles and not the owner has no access."""
    resp = await async_client.get(
        f"/api/v1/documents/{owned_document.id}",
        headers=other_headers,
    )
    assert resp.status_code == 403


async def test_owner_can_always_manage(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_document: Document,
    group: Group,
):
    """Owner always has manager permission (implicit), can share/list/revoke."""
    # Share
    resp = await async_client.post(
        f"/api/v1/documents/{owned_document.id}/permissions",
        json={"group_id": str(group.id), "permission": "viewer"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    perm_id = resp.json()["id"]

    # List
    resp = await async_client.get(
        f"/api/v1/documents/{owned_document.id}/permissions",
        headers=auth_headers,
    )
    assert resp.status_code == 200

    # Update
    resp = await async_client.patch(
        f"/api/v1/documents/{owned_document.id}/permissions/{perm_id}",
        json={"permission": "editor"},
        headers=auth_headers,
    )
    assert resp.status_code == 200

    # Revoke
    resp = await async_client.delete(
        f"/api/v1/documents/{owned_document.id}/permissions/{perm_id}",
        headers=auth_headers,
    )
    assert resp.status_code == 204


# ── Bulk Delete with ACL ────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def second_owned_document(
    db_session: AsyncSession,
    test_user: User,
    owned_folder: Folder,
    default_storage_config: StorageConfig,
) -> Document:
    """A second document owned by test_user."""
    doc = Document(
        id=uuid.uuid4(),
        title="second.txt",
        description=None,
        file_name=f"{uuid.uuid4()}.txt",
        original_filename="second.txt",
        file_path="/tmp/lumina-test-uploads/second.txt",
        file_size=7,
        mime_type="text/plain",
        extension="txt",
        checksum="second123",
        folder_id=owned_folder.id,
        storage_config_id=default_storage_config.id,
        owner_id=test_user.id,
        source_type="upload",
    )
    db_session.add(doc)
    await db_session.flush()
    return doc


@pytest_asyncio.fixture
async def unowned_document(
    db_session: AsyncSession,
    other_user: User,
    default_storage_config: StorageConfig,
) -> Document:
    """A document owned by other_user (no folder, no ACL grants)."""
    doc = Document(
        id=uuid.uuid4(),
        title="unowned.txt",
        description=None,
        file_name=f"{uuid.uuid4()}.txt",
        original_filename="unowned.txt",
        file_path="/tmp/lumina-test-uploads/unowned.txt",
        file_size=5,
        mime_type="text/plain",
        extension="txt",
        checksum="unowned123",
        folder_id=None,
        storage_config_id=default_storage_config.id,
        owner_id=other_user.id,
        source_type="upload",
    )
    db_session.add(doc)
    await db_session.flush()
    return doc


async def test_bulk_delete_own_documents(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_document: Document,
    second_owned_document: Document,
):
    """Owner can bulk-delete their own documents."""
    resp = await async_client.request(
        "DELETE",
        "/api/v1/documents/bulk",
        json={"document_ids": [str(owned_document.id), str(second_owned_document.id)]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 2


async def test_bulk_delete_as_superuser(
    async_client: AsyncClient,
    admin_headers: dict,
    owned_document: Document,
    second_owned_document: Document,
    superuser: User,
):
    """Superuser can bulk-delete any documents."""
    resp = await async_client.request(
        "DELETE",
        "/api/v1/documents/bulk",
        json={"document_ids": [str(owned_document.id), str(second_owned_document.id)]},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 2


async def test_bulk_delete_with_manager_acl(
    async_client: AsyncClient,
    other_headers: dict,
    owned_document: Document,
    group: Group,
    other_user_with_role: User,
    db_session: AsyncSession,
):
    """User with manager ACL can bulk-delete shared documents."""
    perm = DocumentPermission(
        id=uuid.uuid4(),
        document_id=owned_document.id,
        group_id=group.id,
        permission="manager",
        created_by_id=owned_document.owner_id,
    )
    db_session.add(perm)
    await db_session.flush()

    resp = await async_client.request(
        "DELETE",
        "/api/v1/documents/bulk",
        json={"document_ids": [str(owned_document.id)]},
        headers=other_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 1


async def test_bulk_delete_with_folder_manager_acl(
    async_client: AsyncClient,
    other_headers: dict,
    owned_document: Document,
    owned_folder: Folder,
    group: Group,
    other_user_with_role: User,
    db_session: AsyncSession,
):
    """User with manager ACL on folder can bulk-delete documents in it."""
    perm = DocumentPermission(
        id=uuid.uuid4(),
        folder_id=owned_folder.id,
        group_id=group.id,
        permission="manager",
        created_by_id=owned_folder.owner_id,
    )
    db_session.add(perm)
    await db_session.flush()

    resp = await async_client.request(
        "DELETE",
        "/api/v1/documents/bulk",
        json={"document_ids": [str(owned_document.id)]},
        headers=other_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 1


async def test_bulk_delete_with_inherited_folder_manager_acl(
    async_client: AsyncClient,
    other_headers: dict,
    subfolder_document: Document,
    owned_folder: Folder,
    owned_subfolder: Folder,
    group: Group,
    other_user_with_role: User,
    db_session: AsyncSession,
):
    """Manager ACL on parent folder allows bulk-delete of docs in subfolder."""
    perm = DocumentPermission(
        id=uuid.uuid4(),
        folder_id=owned_folder.id,
        group_id=group.id,
        permission="manager",
        created_by_id=owned_folder.owner_id,
    )
    db_session.add(perm)
    await db_session.flush()

    resp = await async_client.request(
        "DELETE",
        "/api/v1/documents/bulk",
        json={"document_ids": [str(subfolder_document.id)]},
        headers=other_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 1


async def test_bulk_delete_skips_no_permission(
    async_client: AsyncClient,
    other_headers: dict,
    owned_document: Document,
    other_user: User,
):
    """User with no permission: bulk delete returns 0."""
    resp = await async_client.request(
        "DELETE",
        "/api/v1/documents/bulk",
        json={"document_ids": [str(owned_document.id)]},
        headers=other_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 0


async def test_bulk_delete_skips_editor_permission(
    async_client: AsyncClient,
    other_headers: dict,
    owned_document: Document,
    group: Group,
    other_user_with_role: User,
    db_session: AsyncSession,
):
    """Editor ACL is not enough for delete: bulk delete returns 0."""
    perm = DocumentPermission(
        id=uuid.uuid4(),
        document_id=owned_document.id,
        group_id=group.id,
        permission="editor",
        created_by_id=owned_document.owner_id,
    )
    db_session.add(perm)
    await db_session.flush()

    resp = await async_client.request(
        "DELETE",
        "/api/v1/documents/bulk",
        json={"document_ids": [str(owned_document.id)]},
        headers=other_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 0


async def test_bulk_delete_mixed_permissions(
    async_client: AsyncClient,
    other_headers: dict,
    owned_document: Document,
    second_owned_document: Document,
    group: Group,
    other_user_with_role: User,
    db_session: AsyncSession,
):
    """Mixed: manager ACL on one doc, no permission on another. Deletes only the allowed one."""
    # Grant manager on owned_document only
    perm = DocumentPermission(
        id=uuid.uuid4(),
        document_id=owned_document.id,
        group_id=group.id,
        permission="manager",
        created_by_id=owned_document.owner_id,
    )
    db_session.add(perm)
    await db_session.flush()

    resp = await async_client.request(
        "DELETE",
        "/api/v1/documents/bulk",
        json={"document_ids": [str(owned_document.id), str(second_owned_document.id)]},
        headers=other_headers,
    )
    assert resp.status_code == 200
    # owned_document: has manager ACL → deleted
    # second_owned_document: owned by test_user, other_user has no ACL → skipped
    assert resp.json()["deleted"] == 1


async def test_bulk_delete_nonexistent_doc_ids(
    async_client: AsyncClient,
    auth_headers: dict,
):
    """Non-existent doc IDs are silently skipped."""
    resp = await async_client.request(
        "DELETE",
        "/api/v1/documents/bulk",
        json={"document_ids": [str(uuid.uuid4()), str(uuid.uuid4())]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 0


async def test_bulk_delete_already_deleted_doc(
    async_client: AsyncClient,
    auth_headers: dict,
    owned_document: Document,
):
    """Already soft-deleted document is skipped in bulk delete."""
    # Delete first
    await async_client.delete(
        f"/api/v1/documents/{owned_document.id}",
        headers=auth_headers,
    )

    # Bulk delete same doc
    resp = await async_client.request(
        "DELETE",
        "/api/v1/documents/bulk",
        json={"document_ids": [str(owned_document.id)]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 0


async def test_bulk_delete_empty_list(
    async_client: AsyncClient,
    auth_headers: dict,
):
    """Empty doc_ids list returns 0."""
    resp = await async_client.request(
        "DELETE",
        "/api/v1/documents/bulk",
        json={"document_ids": []},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 0
