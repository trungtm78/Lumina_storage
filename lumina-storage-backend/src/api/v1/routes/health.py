import logging

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check() -> dict:
    """Liveness: process còn sống (KHÔNG kiểm tra dependency)."""
    return {"status": "ok", "version": "1.0.0"}


@router.get("/health/ready")
async def readiness(response: Response, db: AsyncSession = Depends(get_db)) -> dict:
    """Readiness: kiểm tra dependency thật (DB). Trả 503 nếu DB không truy cập được
    để orchestrator/load-balancer gate traffic đúng."""
    checks = {"db": False}
    try:
        await db.execute(text("SELECT 1"))
        checks["db"] = True
    except Exception:
        logger.warning("readiness: DB check failed", exc_info=True)
        checks["db"] = False
    if not all(checks.values()):
        response.status_code = 503
    return checks
