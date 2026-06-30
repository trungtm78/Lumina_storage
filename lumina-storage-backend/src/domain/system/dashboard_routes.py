from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import CurrentUser
from src.core.config import get_settings
from src.core.database import get_db
from src.schemas.dashboard import (
    DashboardStatsResponse,
    ProcessingFileItem,
    RecentFileItem,
    SharedFileItem,
)
from src.domain.system.dashboard import DashboardService
from src.domain.system.dashboard_export import build_dashboard_report_html

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _svc(db: AsyncSession = Depends(get_db)) -> DashboardService:
    return DashboardService(db)


@router.get("/stats", response_model=DashboardStatsResponse)
async def get_dashboard_stats(
    current_user: CurrentUser,
    svc: DashboardService = Depends(_svc),
) -> DashboardStatsResponse:
    return await svc.get_stats(current_user)


@router.get("/recent-files", response_model=list[RecentFileItem])
async def get_recent_files(
    current_user: CurrentUser,
    svc: DashboardService = Depends(_svc),
) -> list[RecentFileItem]:
    data = await svc.get_recent_files(current_user)
    return [RecentFileItem(**item) for item in data]


@router.get("/processing-data", response_model=list[ProcessingFileItem])
async def get_processing_data(
    current_user: CurrentUser,
    svc: DashboardService = Depends(_svc),
) -> list[ProcessingFileItem]:
    data = await svc.get_processing_data(current_user)
    return [ProcessingFileItem(**item) for item in data]


@router.get("/shared-files", response_model=list[SharedFileItem])
async def get_shared_files(
    current_user: CurrentUser,
    svc: DashboardService = Depends(_svc),
) -> list[SharedFileItem]:
    data = await svc.get_shared_files(current_user)
    return [SharedFileItem(**item) for item in data]


@router.get("/report")
async def download_report(
    current_user: CurrentUser,
    svc: DashboardService = Depends(_svc),
) -> Response:
    stats = await svc.get_stats(current_user)
    recent = await svc.get_recent_files(current_user, limit=20)
    processing = await svc.get_processing_data(current_user, limit=20)
    shared = await svc.get_shared_files(current_user, limit=20)

    user_name = getattr(current_user, "full_name", None) or getattr(current_user, "email", "")
    html = build_dashboard_report_html(
        stats=stats.model_dump(),
        recent_files=recent,
        processing_data=processing,
        shared_files=shared,
        user_name=user_name,
    )

    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    fname = f"lumina_dashboard_{date_str}.pdf"

    settings = get_settings()
    gotenberg_url = settings.gotenberg_url
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{gotenberg_url}/forms/chromium/convert/html",
                files={"files": ("index.html", html.encode("utf-8"), "text/html")},
                data={"paperFormat": "A4"},
            )
        if resp.status_code == 200:
            return Response(
                content=resp.content,
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="{fname}"'},
            )
    except Exception:
        pass

    return JSONResponse(
        status_code=503,
        content={"detail": "PDF generation service unavailable. Please try again later."},
    )
