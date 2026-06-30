import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import NotFoundError
from src.models.user import User
from src.repositories.document import FolderRepository
from src.schemas.document import FolderCreateRequest, FolderResponse, FolderUpdateRequest
from src.services.document_permission import DocumentPermissionService


class FolderService:
    def __init__(self, session: AsyncSession) -> None:
        self.folder_repo = FolderRepository(session)
        self.perm_svc = DocumentPermissionService(session)

    async def create_folder(
        self, data: FolderCreateRequest, owner: User
    ) -> FolderResponse:
        parent_path = ""
        if data.parent_id:
            parent = await self.folder_repo.get_by_id_active(data.parent_id)
            if not parent:
                raise NotFoundError("Parent folder not found")
            await self.perm_svc.check_permission(owner, folder_id=data.parent_id, required="editor")
            parent_path = parent.path

        folder = await self.folder_repo.create({
            "name": data.name,
            "parent_id": data.parent_id,
            "owner_id": owner.id,
            "path": "",
        })
        folder.path = f"{parent_path}/{folder.id}"
        return FolderResponse.model_validate(folder)

    async def list_folders(
        self, parent_id: uuid.UUID | None, owner: User, shared_with_me: bool | None = None
    ) -> list[FolderResponse]:
        group_ids = await self.perm_svc.get_user_group_ids(owner)
        folders = await self.folder_repo.get_by_parent(
            parent_id, owner.id, group_ids=group_ids, shared_with_me=shared_with_me
        )
        return [FolderResponse.model_validate(f) for f in folders]

    async def get_folder(self, folder_id: uuid.UUID, owner: User) -> FolderResponse:
        await self.perm_svc.check_permission(owner, folder_id=folder_id, required="viewer")
        folder = await self.folder_repo.get_by_id_active(folder_id)
        if not folder:
            raise NotFoundError("Folder not found")
        return FolderResponse.model_validate(folder)

    async def update_folder(
        self, folder_id: uuid.UUID, data: FolderUpdateRequest, owner: User
    ) -> FolderResponse:
        await self.perm_svc.check_permission(owner, folder_id=folder_id, required="editor")
        folder = await self.folder_repo.get_by_id_active(folder_id)
        if not folder:
            raise NotFoundError("Folder not found")
        folder = await self.folder_repo.rename(folder, data.name.strip())
        return FolderResponse.model_validate(folder)

    async def delete_folder(self, folder_id: uuid.UUID, owner: User) -> None:
        await self.perm_svc.check_permission(owner, folder_id=folder_id, required="manager")
        folder = await self.folder_repo.get_by_id_active(folder_id)
        if not folder:
            raise NotFoundError("Folder not found")
        await self.folder_repo.soft_delete_subtree(folder)
