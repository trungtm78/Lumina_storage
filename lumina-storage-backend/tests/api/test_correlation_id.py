"""Test correlation-id middleware: mọi response có X-Request-ID; echo khi client gửi."""
import uuid

import pytest

pytestmark = pytest.mark.asyncio


async def test_response_has_request_id(async_client):
    r = await async_client.get("/api/v1/health")
    assert r.headers.get("X-Request-ID")


async def test_request_id_echoed_when_provided(async_client):
    cid = str(uuid.uuid4())
    r = await async_client.get("/api/v1/health", headers={"X-Request-ID": cid})
    assert r.headers.get("X-Request-ID") == cid


async def test_500_response_includes_request_id():
    """Unhandled 500 vẫn phải mang X-Request-ID (client cần đúng lúc lỗi)."""
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from asgi_correlation_id import CorrelationIdMiddleware

    from src.core.exceptions import register_exception_handlers

    app = FastAPI()
    app.add_middleware(CorrelationIdMiddleware, header_name="X-Request-ID")
    register_exception_handlers(app)

    @app.get("/boom")
    async def boom():
        raise RuntimeError("kaboom")

    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/boom")
    assert r.status_code == 500
    assert r.headers.get("X-Request-ID")
