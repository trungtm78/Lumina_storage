import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from src.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from src.models.group import Group
from src.models.user import User
from src.repositories.document import DocumentRepository, FolderRepository
from src.repositories.document_permission import PERMISSION_RANK, DocumentPermissionRepository
from src.repositories.group import GroupRepository
from src.repositories.user import UserRepository


class DocumentPermissionService:
    def __init__(self, session: AsyncSession) -> None:
        self.perm_repo = DocumentPermissionRepository(session)
        self.doc_repo = DocumentRepository(session)
        self.folder_repo = FolderRepository(session)
        self.group_repo = GroupRepository(session)
        self.user_repo = UserRepository(session)

    @staticmethod
    def _get_role_ids(user: User) -> list[uuid.UUID]:
        return [ur.role_id for ur in user.roles]

    @staticmethod
    def _is_admin(user: User) -> bool:
        return any(ur.role and ur.role.is_default for ur in user.roles)

    async def get_user_group_ids(self, user: User) -> list[uuid.UUID]:
        role_ids = self._get_role_ids(user)
        return await self.group_repo.get_user_group_ids(user.id, role_ids)

    async def check_permission(
        self,
        user: User,
        document_id: uuid.UUID | None = None,
        folder_id: uuid.UUID | None = None,
        required: str = "viewer",
    ) -> str:
        if self._is_admin(user):
            return "manager"

        if document_id:
            doc = await self.doc_repo.get_by_id_active(document_id)
            if not doc:
                raise NotFoundError("Document not found")
            if doc.owner_id == user.id:
                return "manager"
            doc_folder_id = doc.folder_id
            folder_path = None
            if doc.folder_id:
                folder = await self.folder_repo.get_by_id(doc.folder_id)
                folder_path = folder.path if folder else None
        elif folder_id:
            folder = await self.folder_repo.get_by_id(folder_id)
            if not folder:
                raise NotFoundError("Folder not found")
            if folder.owner_id == user.id:
                return "manager"
            doc_folder_id = folder_id
            folder_path = folder.path
        else:
            raise BadRequestError("Must specify document_id or folder_id")

        group_ids = await self.get_user_group_ids(user)
        effective = await self.perm_repo.get_effective_permission(
            document_id=document_id,
            folder_id=doc_folder_id if document_id else folder_id,
            folder_path=folder_path,
            group_ids=group_ids,
            user_id=user.id,
        )

        if effective is None or PERMISSION_RANK.get(effective, 0) < PERMISSION_RANK[required]:
            action_map = {
                "viewer": "view",
                "editor": "edit",
                "manager": "manage",
            }
            action = action_map.get(required, required)
            raise ForbiddenError(f"You need at least '{required}' permission to {action} this resource")

        return effective

    async def share_document(
        self,
        document_id: uuid.UUID,
        permission: str,
        current_user: User,
        group_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
    ) -> dict:
        await self.check_permission(current_user, document_id=document_id, required="manager")
        self._validate_permission_level(permission)

        if group_id:
            if not await self.group_repo.get_by_id(group_id):
                raise NotFoundError("Group not found")
        elif user_id:
            if not await self.user_repo.get_by_id(user_id):
                raise NotFoundError("User not found")
        else:
            raise BadRequestError("Must specify group_id or user_id")

        try:
            return await self.perm_repo.create({
                "document_id": document_id,
                "group_id": group_id,
                "user_id": user_id,
                "permission": permission,
                "created_by_id": current_user.id,
            })
        except IntegrityError:
            raise ConflictError("This grantee already has permission on this document")

    async def share_folder(
        self,
        folder_id: uuid.UUID,
        permission: str,
        current_user: User,
        group_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
    ) -> dict:
        await self.check_permission(current_user, folder_id=folder_id, required="manager")
        self._validate_permission_level(permission)

        if group_id:
            if not await self.group_repo.get_by_id(group_id):
                raise NotFoundError("Group not found")
        elif user_id:
            if not await self.user_repo.get_by_id(user_id):
                raise NotFoundError("User not found")
        else:
            raise BadRequestError("Must specify group_id or user_id")

        try:
            return await self.perm_repo.create({
                "folder_id": folder_id,
                "group_id": group_id,
                "user_id": user_id,
                "permission": permission,
                "created_by_id": current_user.id,
            })
        except IntegrityError:
            raise ConflictError("This grantee already has permission on this folder")

    async def update_permission(self, perm_id: uuid.UUID, permission: str, current_user: User) -> dict:
        perm = await self.perm_repo.get_by_id(perm_id)
        if not perm:
            raise NotFoundError("Permission not found")
        await self.check_permission(
            current_user, document_id=perm.document_id, folder_id=perm.folder_id, required="manager",
        )
        self._validate_permission_level(permission)
        return await self.perm_repo.update_permission_level(perm_id, permission)

    async def revoke_permission(self, perm_id: uuid.UUID, current_user: User) -> None:
        perm = await self.perm_repo.get_by_id(perm_id)
        if not perm:
            raise NotFoundError("Permission not found")
        await self.check_permission(
            current_user, document_id=perm.document_id, folder_id=perm.folder_id, required="manager",
        )
        await self.perm_repo.delete(perm_id)

    async def _enrich_permissions(self, perms: list) -> list[dict]:
        if not perms:
            return []

        group_ids = list({p.group_id for p in perms if p.group_id})
        user_ids = list({p.user_id for p in perms if p.user_id})

        group_name_map: dict[uuid.UUID, str] = {}
        if group_ids:
            result = await self.group_repo.session.execute(
                select(Group.id, Group.name).where(Group.id.in_(group_ids))
            )
            group_name_map = {row.id: row.name for row in result}

        user_info_map: dict[uuid.UUID, dict] = {}
        if user_ids:
            result = await self.user_repo.session.execute(
                select(User.id, User.full_name, User.email).where(User.id.in_(user_ids))
            )
            user_info_map = {row.id: {"full_name": row.full_name, "email": row.email} for row in result}

        return [
            {
                "id": p.id,
                "document_id": p.document_id,
                "folder_id": p.folder_id,
                "group_id": p.group_id,
                "group_name": group_name_map.get(p.group_id) if p.group_id else None,
                "user_id": p.user_id,
                "user_name": user_info_map[p.user_id]["full_name"] if p.user_id and p.user_id in user_info_map else None,
                "user_email": user_info_map[p.user_id]["email"] if p.user_id and p.user_id in user_info_map else None,
                "permission": p.permission,
                "created_at": p.created_at,
                "created_by_id": p.created_by_id,
            }
            for p in perms
        ]

    async def list_document_permissions(self, document_id: uuid.UUID, current_user: User) -> list:
        await self.check_permission(current_user, document_id=document_id, required="viewer")
        perms = await self.perm_repo.get_for_document(document_id)
        return await self._enrich_permissions(perms)

    async def list_folder_permissions(self, folder_id: uuid.UUID, current_user: User) -> list:
        await self.check_permission(current_user, folder_id=folder_id, required="viewer")
        perms = await self.perm_repo.get_for_folder(folder_id)
        return await self._enrich_permissions(perms)

    @staticmethod
    def _validate_permission_level(permission: str) -> None:
        if permission not in PERMISSION_RANK:
            raise BadRequestError(f"Invalid permission level: {permission}. Must be one of: viewer, editor, manager")
