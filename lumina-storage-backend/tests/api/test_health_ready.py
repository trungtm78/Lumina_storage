"""Test readiness probe /health/ready (check DB); liveness /health KHÔNG đổi."""
import pytest

pytestmark = pytest.mark.asyncio


async def test_ready_ok_when_db_up(async_client):
    r = await async_client.get("/api/v1/health/ready")
    assert r.status_code == 200
    assert r.json()["db"] is True


async def test_liveness_unchanged(async_client):
    r = await async_client.get("/api/v1/health")
    assert r.json() == {"status": "ok", "version": "1.0.0"}


async def test_ready_503_when_db_down():
    """DB không truy cập được → 503 + {'db': false} để gate traffic."""
    from httpx import ASGITransport, AsyncClient

    from main import create_app
    from src.core.database import get_db

    app = create_app()

    class _BadSession:
        async def execute(self, *a, **k):
            raise RuntimeError("db down")

    async def override_get_db():
        yield _BadSession()

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/v1/health/ready")
    assert r.status_code == 503
    assert r.json()["db"] is False
