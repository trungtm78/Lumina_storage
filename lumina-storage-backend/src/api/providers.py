"""DI providers cho route — nâng cấp FastAPI Depends.

Thay vì khởi tạo service trực tiếp trong route, route dùng Depends(get_*).
Service singleton (vd SkillService) lấy từ app.state (gán ở lifespan).
"""
from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.services.generator_service import GeneratorService
from src.services.skill_service import SkillService


def get_skill_service(request: Request) -> SkillService:
    svc = getattr(request.app.state, "skill_service", None)
    # isinstance guard: chặn cả None lẫn object sai kiểu bị inject nhầm.
    if not isinstance(svc, SkillService):
        # Service chưa sẵn sàng = 503 (readiness), KHÔNG phải 500 internal error.
        raise HTTPException(status_code=503, detail="SkillService unavailable")
    return svc


def get_generator_service(db: AsyncSession = Depends(get_db)) -> GeneratorService:
    """Service per-request bọc generator repository (Phase 6 — route không gọi repo trực tiếp)."""
    return GeneratorService(db)
