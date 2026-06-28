"""Test DI providers: get_skill_service đọc instance từ app.state."""
import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio


async def test_provider_resolves_from_app_state():
    from src.api.providers import get_skill_service
    from src.core.config import get_settings
    from src.services.skill_service import SkillService

    app = FastAPI()
    svc = SkillService(get_settings())
    app.state.skill_service = svc

    @app.get("/_t")
    async def _t(s: SkillService = Depends(get_skill_service)):
        return {"same": s is svc}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/_t")
    assert r.json()["same"] is True


async def test_provider_raises_when_not_initialized():
    from src.api.providers import get_skill_service

    app = FastAPI()

    @app.get("/_t")
    async def _t(s=Depends(get_skill_service)):
        return {"ok": True}

    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test"
    ) as client:
        r = await client.get("/_t")
    assert r.status_code == 503  # service chưa sẵn sàng → 503 (không phải 500)
