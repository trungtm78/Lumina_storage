import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_arq_pool, get_current_user
from src.core.database import get_db
from src.models.core import AuditLog
from src.models.user import User
from src.schemas.document import GoogleDriveImportRequest, GoogleDriveImportResponse
from src.services.google_drive import GoogleDriveService
from src.worker.dispatch import dispatch_task

router = APIRouter(prefix="/google-drive", tags=["google-drive"])


def _svc(db: AsyncSession = Depends(get_db)) -> GoogleDriveService:
    return GoogleDriveService(db)


@router.post("/import", response_model=list[GoogleDriveImportResponse], status_code=201)
async def import_from_drive(
    request: Request,
    data: GoogleDriveImportRequest,
    current_user: User = Depends(get_current_user),
    svc: GoogleDriveService = Depends(_svc),
    db: AsyncSession = Depends(get_db),
) -> list[GoogleDriveImportResponse]:
    results = await svc.import_from_url(data.url, data.folder_id, current_user)
    arq_pool = get_arq_pool(request)
    for result in results:
        if result.document_id is None:
            continue
        db.add(AuditLog(
            user_id=current_user.id,
            action="document.upload",
            resource_type="document",
            resource_id=result.document_id,
        ))
        await arq_pool.enqueue_job("generate_thumbnail_task", result.document_id)
        await dispatch_task(
            arq_pool=arq_pool,
            func_name="ingest_document_task",
            task_name="ingest_document",
            db=db,
            owner_id=current_user.id,
            related_type="document",
            related_id=result.document_id,
            document_id=result.document_id,
        )
        if data.is_template:
            await dispatch_task(
                arq_pool=arq_pool,
                func_name="extract_template_task",
                task_name="extract_template",
                db=db,
                owner_id=current_user.id,
                related_type="document",
                related_id=result.document_id,
                document_id=result.document_id,
                user_id=current_user.id,
            )
    return results


@router.get("/imports", response_model=list[GoogleDriveImportResponse])
async def list_imports(
    current_user: User = Depends(get_current_user),
    svc: GoogleDriveService = Depends(_svc),
) -> list[GoogleDriveImportResponse]:
    return await svc.list_imports(current_user)


@router.get("/imports/{import_id}", response_model=GoogleDriveImportResponse)
async def get_import(
    import_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: GoogleDriveService = Depends(_svc),
) -> GoogleDriveImportResponse:
    return await svc.get_import(import_id, current_user)
