from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, require_admin
from src.core.database import get_db
from src.models.user import User
from src.schemas.system import (
    PublicConfigResponse,
    SystemConfigCreateRequest,
    SystemConfigResponse,
    SystemConfigUpdateRequest,
)
from src.services.system_config import SystemConfigService

router = APIRouter(prefix="/system", tags=["system"])


def _svc(db: AsyncSession = Depends(get_db)) -> SystemConfigService:
    return SystemConfigService(db)


@router.get("/configs/public", response_model=list[PublicConfigResponse])
async def list_public_configs(
    svc: SystemConfigService = Depends(_svc),
) -> list[PublicConfigResponse]:
    return await svc.list_public()


@router.get("/configs", response_model=list[SystemConfigResponse])
async def list_configs(
    _: User = Depends(require_admin),
    svc: SystemConfigService = Depends(_svc),
) -> list[SystemConfigResponse]:
    return await svc.list_all()


@router.get("/configs/{key}", response_model=SystemConfigResponse)
async def get_config(
    key: str,
    _: User = Depends(require_admin),
    svc: SystemConfigService = Depends(_svc),
) -> SystemConfigResponse:
    return await svc.get_by_key(key)


@router.post("/configs", response_model=SystemConfigResponse, status_code=201)
async def create_config(
    data: SystemConfigCreateRequest,
    admin: User = Depends(require_admin),
    svc: SystemConfigService = Depends(_svc),
) -> SystemConfigResponse:
    return await svc.create(data, admin)


@router.patch("/configs/{key}", response_model=SystemConfigResponse)
async def update_config(
    key: str,
    data: SystemConfigUpdateRequest,
    admin: User = Depends(require_admin),
    svc: SystemConfigService = Depends(_svc),
) -> SystemConfigResponse:
    return await svc.update(key, data, admin)


@router.delete("/configs/{key}", status_code=204)
async def delete_config(
    key: str,
    _: User = Depends(require_admin),
    svc: SystemConfigService = Depends(_svc),
) -> None:
    await svc.delete(key)


# ── Skill Model Config ───────────────────────────────────────────────

SKILL_MODEL_CONFIG_KEY = "skill_model_config"


class SkillModelConfigRequest(BaseModel):
    config: dict[str, str | None]  # {skill_name: model_config_id | null}


@router.get("/skill-model-config")
async def get_skill_model_config(
    _: User = Depends(get_current_user),
    svc: SystemConfigService = Depends(_svc),
) -> dict:
    """Get per-skill model config. Returns {skill_name: model_config_id}."""
    from src.core.config import get_settings
    from src.services.skill_service import SkillService

    # Get saved config
    try:
        cfg = await svc.get_by_key(SKILL_MODEL_CONFIG_KEY)
        saved = cfg.value or {}
    except Exception:
        saved = {}

    # Get available skills
    skill_svc = SkillService(get_settings())
    skills = []
    for skill in skill_svc.skills:
        skills.append({
            "name": skill.name,
            "description": skill.description[:200],
            "model_config_id": saved.get(skill.name),
        })

    return {"skills": skills}


@router.put("/skill-model-config")
async def set_skill_model_config(
    body: SkillModelConfigRequest,
    admin: User = Depends(require_admin),
    svc: SystemConfigService = Depends(_svc),
) -> dict:
    """Set per-skill model config."""
    try:
        await svc.update(
            SKILL_MODEL_CONFIG_KEY,
            SystemConfigUpdateRequest(value=body.config),
            admin,
        )
    except Exception:
        await svc.create(
            SystemConfigCreateRequest(
                key=SKILL_MODEL_CONFIG_KEY,
                value=body.config,
                description="Per-skill LLM model configuration",
                is_public=False,
            ),
            admin,
        )
    return {"status": "ok"}


# ── Branding Settings ────────────────────────────────────────────────

BRANDING_CONFIG_KEY = "branding"

# Default branding settings
DEFAULT_BRANDING = {
    "title": "Lumina Storage",
    "logo_url": None,
    "favicon_url": None,
    "primary_color": "#E64C5B",
    "secondary_color": "#FFE8EB",
    "accent_color": None,
    "description": "AI-powered document management system",
    "contact_email": None,
    "help_url": None,
}


class BrandingSettings(BaseModel):
    """Branding settings schema"""

    title: str = Field(default="Lumina Storage", max_length=255)
    logo_url: str | None = None
    favicon_url: str | None = None
    primary_color: str = Field(default="#E64C5B", max_length=50)
    secondary_color: str | None = Field(default="#FFE8EB", max_length=50)
    accent_color: str | None = Field(default=None, max_length=50)
    description: str | None = None
    contact_email: str | None = Field(default=None, max_length=255)
    help_url: str | None = None


class BrandingUpdateRequest(BaseModel):
    """Request body for updating branding settings"""

    title: str | None = Field(default=None, max_length=255)
    logo_url: str | None = None
    favicon_url: str | None = None
    primary_color: str | None = Field(default=None, max_length=50)
    secondary_color: str | None = Field(default=None, max_length=50)
    accent_color: str | None = Field(default=None, max_length=50)
    description: str | None = None
    contact_email: str | None = Field(default=None, max_length=255)
    help_url: str | None = None


class BrandingResponse(BaseModel):
    """Response for branding settings"""

    success: bool
    data: BrandingSettings
    message: str | None = None


@router.get("/branding", response_model=BrandingResponse)
async def get_branding_settings(
    svc: SystemConfigService = Depends(_svc),
) -> BrandingResponse:
    """
    Get branding settings (public endpoint)
    Returns logo, title, colors, etc.
    """
    try:
        cfg = await svc.get_by_key(BRANDING_CONFIG_KEY)
        data = {**DEFAULT_BRANDING, **(cfg.value or {})}
        return BrandingResponse(success=True, data=BrandingSettings(**data))
    except Exception:
        # Return defaults if not configured yet
        return BrandingResponse(success=True, data=BrandingSettings(**DEFAULT_BRANDING))


@router.put("/branding", response_model=BrandingResponse)
async def update_branding_settings(
    body: BrandingUpdateRequest,
    admin: User = Depends(require_admin),
    svc: SystemConfigService = Depends(_svc),
) -> BrandingResponse:
    """
    Update branding settings (admin only)
    Only updates provided fields, preserves others.
    """
    # Get current settings
    try:
        cfg = await svc.get_by_key(BRANDING_CONFIG_KEY)
        current = {**DEFAULT_BRANDING, **(cfg.value or {})}
    except Exception:
        current = {**DEFAULT_BRANDING}

    # Merge updates (only non-None values)
    updates = body.model_dump(exclude_unset=True)
    for key, value in updates.items():
        current[key] = value

    # Save updated settings
    try:
        await svc.update(
            BRANDING_CONFIG_KEY,
            SystemConfigUpdateRequest(value=current),
            admin,
        )
    except Exception:
        await svc.create(
            SystemConfigCreateRequest(
                key=BRANDING_CONFIG_KEY,
                value=current,
                description="System branding configuration",
                is_public=True,
            ),
            admin,
        )

    return BrandingResponse(
        success=True,
        data=BrandingSettings(**current),
        message="Branding settings updated successfully",
    )


@router.post("/branding/reset", response_model=BrandingResponse)
async def reset_branding_settings(
    admin: User = Depends(require_admin),
    svc: SystemConfigService = Depends(_svc),
) -> BrandingResponse:
    """
    Reset branding to defaults (admin only)
    """
    try:
        await svc.update(
            BRANDING_CONFIG_KEY,
            SystemConfigUpdateRequest(value=DEFAULT_BRANDING),
            admin,
        )
    except Exception:
        await svc.create(
            SystemConfigCreateRequest(
                key=BRANDING_CONFIG_KEY,
                value=DEFAULT_BRANDING,
                description="System branding configuration",
                is_public=True,
            ),
            admin,
        )

    return BrandingResponse(
        success=True,
        data=BrandingSettings(**DEFAULT_BRANDING),
        message="Branding settings reset to defaults",
    )


# ── Storage Quota Settings ───────────────────────────────────────────

STORAGE_QUOTA_KEY = "storage_quota"
DEFAULT_STORAGE_QUOTA = {"max_gb": 100}


class StorageQuotaSettings(BaseModel):
    max_gb: int = Field(default=100, ge=1, le=1_000_000, description="Maximum storage in GB")


class StorageQuotaUpdateRequest(BaseModel):
    max_gb: int = Field(ge=1, le=1_000_000, description="Maximum storage in GB")


@router.get("/storage-quota", response_model=StorageQuotaSettings)
async def get_storage_quota(
    svc: SystemConfigService = Depends(_svc),
) -> StorageQuotaSettings:
    """Get storage quota settings (public). Returns default if not configured."""
    try:
        cfg = await svc.get_by_key(STORAGE_QUOTA_KEY)
        data = {**DEFAULT_STORAGE_QUOTA, **(cfg.value or {})}
    except Exception:
        data = {**DEFAULT_STORAGE_QUOTA}
    return StorageQuotaSettings(**data)


@router.put("/storage-quota", response_model=StorageQuotaSettings)
async def update_storage_quota(
    body: StorageQuotaUpdateRequest,
    admin: User = Depends(require_admin),
    svc: SystemConfigService = Depends(_svc),
) -> StorageQuotaSettings:
    """Update storage quota settings (admin only)."""
    value = {"max_gb": body.max_gb}
    try:
        await svc.update(STORAGE_QUOTA_KEY, SystemConfigUpdateRequest(value=value), admin)
    except Exception:
        await svc.create(
            SystemConfigCreateRequest(
                key=STORAGE_QUOTA_KEY,
                value=value,
                description="System-wide storage quota",
                is_public=False,
            ),
            admin,
        )
    return StorageQuotaSettings(max_gb=body.max_gb)
