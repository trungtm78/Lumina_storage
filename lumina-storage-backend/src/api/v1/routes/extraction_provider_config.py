"""Phase 5b — route ExtractionProviderConfig (mirror ai_model_config). Admin-only CRUD +
test-connection + set-default; /public + /available cho UI."""
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, require_admin
from src.core.database import get_db
from src.extraction.registry import available_providers
from src.models.user import User
from src.schemas.extraction_provider_config import (
    ExtractionProviderConfigCreateRequest,
    ExtractionProviderConfigResponse,
    ExtractionProviderConfigTestRequest,
    ExtractionProviderConfigTestResponse,
    ExtractionProviderConfigUpdateRequest,
)
from src.services.extraction_provider_config_service import ExtractionProviderConfigService

router = APIRouter(prefix="/extraction-provider-configs", tags=["extraction-provider-configs"])


def _svc(db: AsyncSession = Depends(get_db)) -> ExtractionProviderConfigService:
    return ExtractionProviderConfigService(db)


@router.get("/available", response_model=list[str])
async def list_available_providers(_: User = Depends(require_admin)) -> list[str]:
    """Provider KHẢ DỤNG (SDK optional đã cài) — UI dropdown. Provider thiếu SDK bị ẩn."""
    return available_providers()


@router.get("/public", response_model=list[ExtractionProviderConfigResponse])
async def list_public(
    _: User = Depends(get_current_user),
    svc: ExtractionProviderConfigService = Depends(_svc),
) -> list[ExtractionProviderConfigResponse]:
    return await svc.list_active()


@router.post("/test", response_model=ExtractionProviderConfigTestResponse)
async def test_config(
    data: ExtractionProviderConfigTestRequest,
    _: User = Depends(require_admin),
    svc: ExtractionProviderConfigService = Depends(_svc),
) -> ExtractionProviderConfigTestResponse:
    return await svc.test_config(data)


@router.post("", response_model=ExtractionProviderConfigResponse, status_code=201)
async def create_config(
    data: ExtractionProviderConfigCreateRequest,
    _: User = Depends(require_admin),
    svc: ExtractionProviderConfigService = Depends(_svc),
) -> ExtractionProviderConfigResponse:
    return await svc.create(data)


@router.get("", response_model=list[ExtractionProviderConfigResponse])
async def list_all_configs(
    _: User = Depends(require_admin),
    svc: ExtractionProviderConfigService = Depends(_svc),
) -> list[ExtractionProviderConfigResponse]:
    return await svc.list_all()


@router.get("/{config_id}", response_model=ExtractionProviderConfigResponse)
async def get_config(
    config_id: uuid.UUID,
    _: User = Depends(require_admin),
    svc: ExtractionProviderConfigService = Depends(_svc),
) -> ExtractionProviderConfigResponse:
    return await svc.get_by_id(config_id)


@router.patch("/{config_id}", response_model=ExtractionProviderConfigResponse)
async def update_config(
    config_id: uuid.UUID,
    data: ExtractionProviderConfigUpdateRequest,
    _: User = Depends(require_admin),
    svc: ExtractionProviderConfigService = Depends(_svc),
) -> ExtractionProviderConfigResponse:
    return await svc.update(config_id, data)


@router.delete("/{config_id}", status_code=204)
async def delete_config(
    config_id: uuid.UUID,
    _: User = Depends(require_admin),
    svc: ExtractionProviderConfigService = Depends(_svc),
) -> None:
    await svc.delete(config_id)


@router.patch("/{config_id}/set-default", response_model=ExtractionProviderConfigResponse)
async def set_default(
    config_id: uuid.UUID,
    _: User = Depends(require_admin),
    svc: ExtractionProviderConfigService = Depends(_svc),
) -> ExtractionProviderConfigResponse:
    return await svc.set_default(config_id)
