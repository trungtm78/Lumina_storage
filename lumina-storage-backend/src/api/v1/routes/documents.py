import logging
import uuid
from datetime import datetime

from arq import ArqRedis
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import CurrentUser, get_arq_pool
from src.core.database import get_db
from src.models.document import Document
from src.models.processing import BackgroundTask
from src.schemas.document import ProcessStatusResponse
from src.services.document_permission import DocumentPermissionService
from src.worker.dispatch import dispatch_task
from fastapi import APIRouter, Body, Depends, File, Form, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user
from src.core.database import get_db
from src.models.user import User
from src.schemas.document import (
    BulkDeleteRequest, DocumentPermissionCreateRequest, DocumentPermissionResponse,
    DocumentPermissionUpdateRequest, DocumentResponse, DocumentUpdateRequest, DocumentUploadResponse, MoveToFolderRequest,
)
from src.models.core import AuditLog
from src.services.document import DocumentService

router = APIRouter(prefix="/documents", tags=["documents"])

logger = logging.getLogger(__name__)


async def _enqueue_thumbnail(arq_pool: ArqRedis, doc_id: uuid.UUID) -> None:
    """Phase 3 T4: enqueue thumbnail là best-effort — lỗi Redis KHÔNG làm hỏng upload."""
    try:
        await arq_pool.enqueue_job("generate_thumbnail_task", doc_id)
    except Exception:
        logger.warning("enqueue generate_thumbnail_task failed for %s (recoverable)", doc_id, exc_info=True)


async def _audit(
    db: AsyncSession,
    user_id: uuid.UUID,
    action: str,
    resource_id: uuid.UUID,
) -> None:
    db.add(AuditLog(user_id=user_id, action=action, resource_type="document", resource_id=resource_id))



@router.post("/{document_id}/process", status_code=202)
async def process_document(
    document_id: uuid.UUID,
    current_user: CurrentUser,
    arq_pool: ArqRedis = Depends(get_arq_pool),
    db: AsyncSession = Depends(get_db),
) -> dict:
    perm_svc = DocumentPermissionService(db)
    await perm_svc.check_permission(current_user, document_id=document_id, required="editor")

    document = await db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    task = await dispatch_task(
        arq_pool=arq_pool,
        func_name="ingest_document_task",
        task_name="ingest_document",
        db=db,
        owner_id=current_user.id,
        related_type="document",
        related_id=document_id,
        document_id=document_id,
    )

    return {
        "id": str(task.id),
        "job_id": task.job_id,
        "status": task.status,
        "task_name": task.task_name,
        "created_at": task.created_at,
    }


@router.get("/{document_id}/process/status", response_model=ProcessStatusResponse)
async def get_process_status(
    document_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ProcessStatusResponse:
    perm_svc = DocumentPermissionService(db)
    await perm_svc.check_permission(current_user, document_id=document_id, required="viewer")

    document = await db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    result = await db.execute(
        select(BackgroundTask)
        .where(
            BackgroundTask.related_type == "document",
            BackgroundTask.related_id == document_id,
        )
        .order_by(BackgroundTask.created_at.desc())
        .limit(1)
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="No processing task found for this document")

    return ProcessStatusResponse(
        id=task.id,
        task_name=task.task_name,
        status=task.status,
        result=task.result,
        error_message=task.error_message,
        created_at=task.created_at,
        started_at=task.started_at,
        completed_at=task.completed_at,
    )
def _svc(db: AsyncSession = Depends(get_db)) -> DocumentService:
    return DocumentService(db)


@router.post("/upload", response_model=list[DocumentResponse], status_code=201)
async def upload_files(
    request: Request,
    files: list[UploadFile] = File(...),
    folder_id: uuid.UUID | None = Form(None),
    storage_config_id: uuid.UUID | None = Form(None),
    is_template: bool = Form(False),
    source_type: str = Form("upload"),
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
    db: AsyncSession = Depends(get_db),
) -> list[DocumentResponse]:
    docs = await svc.upload_files(files, folder_id, current_user, storage_config_id, source_type=source_type)
    # Phase 3 T4 — COMMIT TRƯỚC ENQUEUE: doc phải bền để worker thumbnail/ingest thấy.
    await db.commit()
    arq_pool = get_arq_pool(request)
    for doc in docs:
        await _audit(db, current_user.id, "document.upload", doc.id)
        await _enqueue_thumbnail(arq_pool, doc.id)
        await dispatch_task(
            arq_pool=arq_pool,
            func_name="ingest_document_task",
            task_name="ingest_document",
            db=db,
            owner_id=current_user.id,
            related_type="document",
            related_id=doc.id,
            document_id=doc.id,
        )
        if is_template:
            await dispatch_task(
                arq_pool=arq_pool,
                func_name="extract_template_task",
                task_name="extract_template",
                db=db,
                owner_id=current_user.id,
                related_type="document",
                related_id=doc.id,
                document_id=doc.id,
                user_id=current_user.id,
            )
    return docs


@router.post("/upload-folder", response_model=DocumentUploadResponse, status_code=201)
async def upload_folder(
    request: Request,
    files: list[UploadFile] = File(...),
    paths: list[str] = Form(...),
    parent_folder_id: uuid.UUID | None = Form(None),
    storage_config_id: uuid.UUID | None = Form(None),
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
    db: AsyncSession = Depends(get_db),
) -> DocumentUploadResponse:
    result = await svc.upload_folder(files, paths, parent_folder_id, current_user, storage_config_id)
    # Phase 3 T4 — COMMIT TRƯỚC ENQUEUE: doc phải bền để worker thumbnail/ingest thấy.
    await db.commit()
    arq_pool = get_arq_pool(request)
    for doc in result.documents:
        await _audit(db, current_user.id, "document.upload", doc.id)
        await _enqueue_thumbnail(arq_pool, doc.id)
        await dispatch_task(
            arq_pool=arq_pool,
            func_name="ingest_document_task",
            task_name="ingest_document",
            db=db,
            owner_id=current_user.id,
            related_type="document",
            related_id=doc.id,
            document_id=doc.id,
        )
    return result


@router.get("/trash", response_model=dict)
async def list_trash(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: str = Query("updated_at"),
    sort_order: str = Query("desc"),
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
) -> dict:
    items, total = await svc.list_trash(current_user, page, page_size, sort_by=sort_by, sort_order=sort_order)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.delete("/bulk", status_code=200)
async def bulk_delete_documents(
    body: BulkDeleteRequest,
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
) -> dict:
    count = await svc.bulk_delete_documents(body.document_ids, current_user)
    return {"deleted": count}


@router.get("", response_model=dict)
async def list_documents(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    folder_id: str | None = Query(None, description="UUID to filter by folder, 'null' for root level, omit for all"),
    extensions: list[str] | None = Query(None),
    uploader_id: uuid.UUID | None = Query(None),
    sort_by: str = Query("updated_at"),
    sort_order: str = Query("desc"),
    start_date: datetime | None = Query(None),
    end_date: datetime | None = Query(None),
    q: str | None = Query(None),
    search_mode: str = Query("keyword"),
    starred: bool | None = Query(None),
    shared_with_me: bool | None = Query(None),
    source_type: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
) -> dict:
    # Parse folder_id: missing = all, "null" = root level, UUID = specific folder
    parsed_folder_id: uuid.UUID | None = ...
    if folder_id is not None:
        if folder_id.lower() == "null":
            parsed_folder_id = None
        else:
            parsed_folder_id = uuid.UUID(folder_id)
    items, total = await svc.list_documents(
        current_user, page, page_size, parsed_folder_id,
        extensions=extensions,
        uploader_id=uploader_id,
        sort_by=sort_by,
        sort_order=sort_order,
        start_date=start_date,
        end_date=end_date,
        q=q,
        search_mode=search_mode,
        starred=starred,
        shared_with_me=shared_with_me,
        source_type=source_type,
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.patch("/{document_id}", response_model=DocumentResponse)
async def update_document(
    document_id: uuid.UUID,
    body: DocumentUpdateRequest,
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
) -> DocumentResponse:
    if body.title is None:
        raise HTTPException(status_code=400, detail="Nothing to update")
    return await svc.rename_document(document_id, body.title, current_user)


@router.patch("/{document_id}/move", response_model=DocumentResponse)
async def move_document(
    document_id: uuid.UUID,
    body: MoveToFolderRequest,
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
) -> DocumentResponse:
    return await svc.move_document(document_id, body.folder_id, current_user)


@router.post("/{document_id}/star", response_model=DocumentResponse)
async def toggle_star(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
) -> DocumentResponse:
    return await svc.toggle_starred(document_id, current_user)


@router.delete("/trash/bulk", status_code=200)
async def bulk_permanent_delete(
    request: Request,
    body: BulkDeleteRequest,
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
) -> dict:
    arq_pool = get_arq_pool(request)
    count = await svc.bulk_permanent_delete(body.document_ids, current_user, arq_pool)
    return {"deleted": count}


@router.post("/{document_id}/restore", response_model=DocumentResponse)
async def restore_document(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
) -> DocumentResponse:
    return await svc.restore_document(document_id, current_user)


@router.delete("/{document_id}/permanent", status_code=204)
async def permanent_delete_document(
    request: Request,
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
) -> None:
    arq_pool = get_arq_pool(request)
    await svc.permanent_delete_document(document_id, current_user, arq_pool)


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
) -> DocumentResponse:
    return await svc.get_document(document_id, current_user)


@router.get("/{document_id}/thumbnail", summary="Get document thumbnail")
async def get_document_thumbnail(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
):
    data = await svc.get_thumbnail(document_id, current_user)
    return Response(content=data, media_type="image/png")


@router.get("/{document_id}/preview-pdf", summary="Preview document as PDF (converts via Gotenberg)")
async def preview_document_as_pdf(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
    db: AsyncSession = Depends(get_db),
):
    data, doc = await svc.get_file_content(document_id, current_user)
    await _audit(db, current_user.id, "document.view", document_id)

    # If already PDF, return directly
    if doc.mime_type == "application/pdf":
        return Response(content=data, media_type="application/pdf",
                        headers={"Content-Disposition": "inline"})

    # Convert to PDF via Gotenberg
    from src.services.skill_service import SkillContext
    from src.core.config import get_settings
    ctx = SkillContext.__new__(SkillContext)
    ctx.settings = get_settings()
    pdf_bytes = await ctx.convert_to_pdf(data, doc.mime_type)
    if not pdf_bytes:
        from fastapi import HTTPException
        raise HTTPException(422, "Cannot convert this file type to PDF for preview")

    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": "inline"})


@router.get("/{document_id}/preview", summary="Preview document inline")
async def preview_document(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
    db: AsyncSession = Depends(get_db),
):
    data, doc = await svc.get_file_content(document_id, current_user)
    await _audit(db, current_user.id, "document.view", document_id)
    from urllib.parse import quote
    encoded = quote(doc.original_filename, safe="")
    return Response(
        content=data,
        media_type=doc.mime_type,
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{encoded}"},
    )


@router.get("/{document_id}/download", summary="Download document file")
async def download_document(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
):
    data, doc = await svc.get_file_content(document_id, current_user)
    from urllib.parse import quote
    import os
    # Use title (user-renamed) + original extension when available,
    # otherwise fall back to original_filename.
    ext = os.path.splitext(doc.original_filename)[1]  # e.g. ".docx"
    display_name = (
        f"{doc.title.strip()}{ext}" if doc.title and doc.title.strip() else doc.original_filename
    )
    # RFC 5987 encoding for Unicode filenames (Vietnamese diacritics) —
    # plain `filename="..."` uses latin-1 and crashes on non-ASCII.
    encoded = quote(display_name, safe="")
    ascii_fallback = display_name.encode("ascii", errors="replace").decode("ascii")
    return Response(
        content=data,
        media_type=doc.mime_type,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_fallback}"; '
                f"filename*=UTF-8''{encoded}"
            )
        },
    )


@router.delete("/{document_id}", status_code=204)
async def delete_document(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: DocumentService = Depends(_svc),
) -> None:
    await svc.delete_document(document_id, current_user)


@router.get("/{document_id}/template-usage")
async def get_template_usage(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    from src.services.generator_service import GeneratorService
    count = await GeneratorService(db).count_drafts_by_template(document_id)
    return {"draft_session_count": count}


# ── Document Permissions ─────────────────────────────────────────────────────

def _perm_svc(db: AsyncSession = Depends(get_db)) -> DocumentPermissionService:
    return DocumentPermissionService(db)


@router.get("/{document_id}/permissions", response_model=list[DocumentPermissionResponse])
async def list_document_permissions(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: DocumentPermissionService = Depends(_perm_svc),
) -> list[DocumentPermissionResponse]:
    perms = await svc.list_document_permissions(document_id, current_user)
    return [DocumentPermissionResponse.model_validate(p) for p in perms]


@router.post("/{document_id}/permissions", response_model=DocumentPermissionResponse, status_code=201)
async def share_document(
    document_id: uuid.UUID,
    data: DocumentPermissionCreateRequest,
    current_user: User = Depends(get_current_user),
    svc: DocumentPermissionService = Depends(_perm_svc),
    db: AsyncSession = Depends(get_db),
) -> DocumentPermissionResponse:
    perm = await svc.share_document(document_id, data.permission, current_user, group_id=data.group_id, user_id=data.user_id)
    await _audit(db, current_user.id, "document.share", document_id)
    return DocumentPermissionResponse.model_validate(perm)


@router.patch("/{document_id}/permissions/{perm_id}", response_model=DocumentPermissionResponse)
async def update_document_permission(
    document_id: uuid.UUID,
    perm_id: uuid.UUID,
    data: DocumentPermissionUpdateRequest,
    current_user: User = Depends(get_current_user),
    svc: DocumentPermissionService = Depends(_perm_svc),
) -> DocumentPermissionResponse:
    perm = await svc.update_permission(perm_id, data.permission, current_user)
    return DocumentPermissionResponse.model_validate(perm)


@router.delete("/{document_id}/permissions/{perm_id}", status_code=204)
async def revoke_document_permission(
    document_id: uuid.UUID,
    perm_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    svc: DocumentPermissionService = Depends(_perm_svc),
) -> None:
    await svc.revoke_permission(perm_id, current_user)
