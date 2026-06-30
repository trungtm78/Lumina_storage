import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, require_admin
from src.core.database import get_db
from src.models.user import User
from src.schemas.document import (
    StorageConfigCreateRequest,
    StorageConfigResponse,
    StorageConfigUpdateRequest,
    UserStorageConfigCreateRequest,
    StorageConnectionTestRequest,
)
from src.domain.storage.storage_config import StorageConfigService

router = APIRouter(prefix="/storage", tags=["storage"])


def _svc(db: AsyncSession = Depends(get_db)) -> StorageConfigService:
    return StorageConfigService(db)


# --- Public: upload limits ---

@router.get("/upload-limits")
async def get_upload_limits(
    svc: StorageConfigService = Depends(_svc),
) -> dict:
    """Return effective per-file upload size limit from the default storage config."""
    return await svc.get_upload_limits()


# --- System-wide Test ---

@router.post("/test-connection")
async def test_connection(
    data: StorageConnectionTestRequest,
    _: User = Depends(require_admin),
    svc: StorageConfigService = Depends(_svc),
) -> dict:
    return await svc.test_connection(data)


# --- Admin (system-wide) ---

@router.post("/configs", response_model=StorageConfigResponse, status_code=201)
async def create_config(
    data: StorageConfigCreateRequest,
    _: User = Depends(require_admin),
    svc: StorageConfigService = Depends(_svc),
) -> StorageConfigResponse:
    return await svc.create_config(data)


@router.get("/configs", response_model=list[StorageConfigResponse])
async def list_configs(
    _: User = Depends(require_admin),
    svc: StorageConfigService = Depends(_svc),
) -> list[StorageConfigResponse]:
    return await svc.list_configs()


@router.patch("/configs/{config_id}", response_model=StorageConfigResponse)
async def update_config(
    config_id: uuid.UUID,
    data: StorageConfigUpdateRequest,
    _: User = Depends(require_admin),
    svc: StorageConfigService = Depends(_svc),
) -> StorageConfigResponse:
    return await svc.update_config(config_id, data)


@router.delete("/configs/{config_id}", status_code=204)
async def delete_config(
    config_id: uuid.UUID,
    _: User = Depends(require_admin),
    svc: StorageConfigService = Depends(_svc),
) -> None:
    await svc.delete_config(config_id)


@router.post("/configs/{config_id}/set-default", response_model=StorageConfigResponse)
async def set_default(
    config_id: uuid.UUID,
    _: User = Depends(require_admin),
    svc: StorageConfigService = Depends(_svc),
) -> StorageConfigResponse:
    return await svc.set_default(config_id)


# --- User (personal) ---

@router.post("/my-configs", response_model=StorageConfigResponse, status_code=201)
async def create_user_config(
    data: UserStorageConfigCreateRequest,
    current_user: User = Depends(get_current_user),
    svc: StorageConfigService = Depends(_svc),
) -> StorageConfigResponse:
    return await svc.create_user_config(data, current_user)


@router.get("/my-configs", response_model=list[StorageConfigResponse])
async def list_user_configs(
    current_user: User = Depends(get_current_user),
    svc: StorageConfigService = Depends(_svc),
) -> list[StorageConfigResponse]:
    return await svc.list_user_configs(current_user)


@router.patch("/my-configs/{config_id}", response_model=StorageConfigResponse)
async def update_user_config(
    config_id: uuid.UUID,
    data: StorageConfigUpdateRequest,
    current_user: User = Depends(get_current_user),
    svc: StorageConfigService = Depends(_svc),
) -> StorageConfigResponse:
    return await svc.update_user_config(config_id, data, current_user)


@router.delete("/my-configs/{config_id}", status_code=204)
async def delete_user_config(
    config_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: StorageConfigService = Depends(_svc),
) -> None:
    await svc.delete_user_config(config_id, current_user)


# --- Admin: orphan cleanup ---

@router.post("/cleanup-orphans")
async def cleanup_orphan_files(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    dry_run: bool = True,
) -> dict:
    """Scan storage for files not referenced by any Document (active or soft-deleted).

    Also keeps files referenced by DocumentVersion + image_thumbnail fields.
    `dry_run=True` (default) just reports counts; set to False to actually delete.
    """
    from sqlalchemy import select
    from src.models.document import Document, DocumentVersion
    from src.models.storage import StorageConfig
    from src.services.storage import get_storage_backend
    import logging

    logger = logging.getLogger(__name__)

    # Collect every file path the DB references (active + soft-deleted)
    referenced: set[str] = set()
    doc_rows = (await db.execute(select(Document.file_path, Document.image_thumbnail))).all()
    for fp, thumb in doc_rows:
        if fp:
            referenced.add(fp)
        if thumb:
            referenced.add(thumb)
    ver_rows = (await db.execute(select(DocumentVersion.file_path))).all()
    for (fp,) in ver_rows:
        if fp:
            referenced.add(fp)

    results: list[dict] = []

    configs = (await db.execute(select(StorageConfig))).scalars().all()
    for cfg in configs:
        backend = get_storage_backend(cfg)
        try:
            all_paths = await backend.list_files()
        except Exception as e:
            results.append({
                "storage_config_id": str(cfg.id),
                "error": f"list_files failed: {e}",
            })
            continue

        orphans = [p for p in all_paths if p not in referenced]

        deleted = 0
        errors: list[str] = []
        if not dry_run:
            for path in orphans:
                try:
                    await backend.delete(path)
                    deleted += 1
                except Exception as e:
                    errors.append(f"{path}: {e}")
                    logger.warning("Orphan delete failed for %s: %s", path, e)

        results.append({
            "storage_config_id": str(cfg.id),
            "storage_name": cfg.name,
            "scanned": len(all_paths),
            "referenced_by_db": len([p for p in all_paths if p in referenced]),
            "orphans_found": len(orphans),
            "deleted": deleted if not dry_run else 0,
            "sample_orphans": orphans[:10],
            "errors": errors,
        })

    return {"dry_run": dry_run, "storages": results}
