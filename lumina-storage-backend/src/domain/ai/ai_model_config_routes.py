import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, require_admin
from src.core.database import get_db
from src.models.user import User
from src.schemas.ai_model_config import (
    AIModelConfigCreateRequest,
    AIModelConfigResponse,
    AIModelConfigTestRequest,
    AIModelConfigTestResponse,
    AIModelConfigUpdateRequest,
)
from src.shared.ai_model_config_service import AIModelConfigService

router = APIRouter(prefix="/ai-model-configs", tags=["ai-model-configs"])


def _svc(db: AsyncSession = Depends(get_db)) -> AIModelConfigService:
    return AIModelConfigService(db)


# Public endpoint — authenticated users (for chat model dropdown)
@router.get("/public", response_model=list[AIModelConfigResponse])
async def list_public(
    purpose: str | None = None,
    _: User = Depends(get_current_user),
    svc: AIModelConfigService = Depends(_svc),
) -> list[AIModelConfigResponse]:
    if purpose:
        return await svc.list_by_purpose(purpose)
    # return all active configs if no purpose filter
    all_configs = await svc.list_all()
    return [c for c in all_configs if c.is_active]


# Admin endpoints

@router.post("/test", response_model=AIModelConfigTestResponse)
async def test_config(
    data: AIModelConfigTestRequest,
    _: User = Depends(require_admin),
    svc: AIModelConfigService = Depends(_svc),
) -> AIModelConfigTestResponse:
    return await svc.test_config(data)


@router.post("", response_model=AIModelConfigResponse, status_code=201)
async def create_config(
    data: AIModelConfigCreateRequest,
    _: User = Depends(require_admin),
    svc: AIModelConfigService = Depends(_svc),
) -> AIModelConfigResponse:
    return await svc.create(data)


@router.get("", response_model=list[AIModelConfigResponse])
async def list_all_configs(
    _: User = Depends(require_admin),
    svc: AIModelConfigService = Depends(_svc),
) -> list[AIModelConfigResponse]:
    return await svc.list_all()


@router.get("/{config_id}", response_model=AIModelConfigResponse)
async def get_config(
    config_id: uuid.UUID,
    _: User = Depends(require_admin),
    svc: AIModelConfigService = Depends(_svc),
) -> AIModelConfigResponse:
    return await svc.get_by_id(config_id)


@router.patch("/{config_id}", response_model=AIModelConfigResponse)
async def update_config(
    config_id: uuid.UUID,
    data: AIModelConfigUpdateRequest,
    _: User = Depends(require_admin),
    svc: AIModelConfigService = Depends(_svc),
) -> AIModelConfigResponse:
    return await svc.update(config_id, data)


@router.delete("/{config_id}", status_code=204)
async def delete_config(
    config_id: uuid.UUID,
    _: User = Depends(require_admin),
    svc: AIModelConfigService = Depends(_svc),
) -> None:
    await svc.delete(config_id)


@router.patch("/{config_id}/set-default", response_model=AIModelConfigResponse)
async def set_default(
    config_id: uuid.UUID,
    _: User = Depends(require_admin),
    svc: AIModelConfigService = Depends(_svc),
) -> AIModelConfigResponse:
    return await svc.set_default(config_id)
