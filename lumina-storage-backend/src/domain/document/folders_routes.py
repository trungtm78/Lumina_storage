import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.core.database import get_db
from src.models.user import User
from src.schemas.document import (
    DocumentPermissionCreateRequest, DocumentPermissionResponse,
    DocumentPermissionUpdateRequest, FolderCreateRequest, FolderResponse,
    FolderUpdateRequest,
)
from src.services.document_permission import DocumentPermissionService
from src.domain.document.folder import FolderService

router = APIRouter(prefix="/folders", tags=["folders"])


def _svc(db: AsyncSession = Depends(get_db)) -> FolderService:
    return FolderService(db)


@router.post("", response_model=FolderResponse, status_code=201)
async def create_folder(
    data: FolderCreateRequest,
    current_user: User = Depends(get_current_user),
    svc: FolderService = Depends(_svc),
) -> FolderResponse:
    return await svc.create_folder(data, current_user)


@router.get("", response_model=list[FolderResponse])
async def list_folders(
    parent_id: uuid.UUID | None = Query(None),
    shared_with_me: bool | None = Query(None),
    current_user: User = Depends(get_current_user),
    svc: FolderService = Depends(_svc),
) -> list[FolderResponse]:
    return await svc.list_folders(parent_id, current_user, shared_with_me=shared_with_me)


@router.get("/{folder_id}", response_model=FolderResponse)
async def get_folder(
    folder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: FolderService = Depends(_svc),
) -> FolderResponse:
    return await svc.get_folder(folder_id, current_user)


@router.patch("/{folder_id}", response_model=FolderResponse)
async def update_folder(
    folder_id: uuid.UUID,
    data: FolderUpdateRequest,
    current_user: User = Depends(get_current_user),
    svc: FolderService = Depends(_svc),
) -> FolderResponse:
    return await svc.update_folder(folder_id, data, current_user)


@router.delete("/{folder_id}", status_code=204)
async def delete_folder(
    folder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: FolderService = Depends(_svc),
) -> None:
    await svc.delete_folder(folder_id, current_user)


# ── Folder Permissions ───────────────────────────────────────────────────────

def _perm_svc(db: AsyncSession = Depends(get_db)) -> DocumentPermissionService:
    return DocumentPermissionService(db)


@router.get("/{folder_id}/permissions", response_model=list[DocumentPermissionResponse])
async def list_folder_permissions(
    folder_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: DocumentPermissionService = Depends(_perm_svc),
) -> list[DocumentPermissionResponse]:
    perms = await svc.list_folder_permissions(folder_id, current_user)
    return [DocumentPermissionResponse.model_validate(p) for p in perms]


@router.post("/{folder_id}/permissions", response_model=DocumentPermissionResponse, status_code=201)
async def share_folder(
    folder_id: uuid.UUID,
    data: DocumentPermissionCreateRequest,
    current_user: User = Depends(get_current_user),
    svc: DocumentPermissionService = Depends(_perm_svc),
) -> DocumentPermissionResponse:
    perm = await svc.share_folder(folder_id, data.permission, current_user, group_id=data.group_id, user_id=data.user_id)
    return DocumentPermissionResponse.model_validate(perm)


@router.patch("/{folder_id}/permissions/{perm_id}", response_model=DocumentPermissionResponse)
async def update_folder_permission(
    folder_id: uuid.UUID,
    perm_id: uuid.UUID,
    data: DocumentPermissionUpdateRequest,
    current_user: User = Depends(get_current_user),
    svc: DocumentPermissionService = Depends(_perm_svc),
) -> DocumentPermissionResponse:
    perm = await svc.update_permission(perm_id, data.permission, current_user)
    return DocumentPermissionResponse.model_validate(perm)


@router.delete("/{folder_id}/permissions/{perm_id}", status_code=204)
async def revoke_folder_permission(
    folder_id: uuid.UUID,
    perm_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: DocumentPermissionService = Depends(_perm_svc),
) -> None:
    await svc.revoke_permission(perm_id, current_user)
