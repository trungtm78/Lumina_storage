"""Microsoft Entra ID token verification for lumina-driver-backend.

Verifies OBO access tokens issued by lumina-backend's Entra OBO exchange.
The expected audience is the Driver API app registration (ENTRA_DRIVER_API_AUDIENCE).

JWKS are fetched from Microsoft's discovery endpoint and cached in-process
per kid with a configurable TTL (default 1 hour).
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx
from jose import JWTError
from jose import jwt as jose_jwt
from jose.backends import RSAKey

from src.core.config import get_settings

logger = logging.getLogger(__name__)

# ── JWKS cache (kid → raw JWK dict) ─────────────────────────────────────────

_cache: dict[str, dict[str, Any]] = {}
_cache_expiry: float = 0.0
_cache_lock = asyncio.Lock()


def _jwks_url() -> str:
    settings = get_settings()
    tid = settings.entra_tenant_id or "common"
    return f"https://login.microsoftonline.com/{tid}/discovery/v2.0/keys"


def _allowed_issuers(tenant_id: str) -> set[str]:
    return {
        f"https://login.microsoftonline.com/{tenant_id}/v2.0",
        f"https://login.microsoftonline.com/{tenant_id}/",
        f"https://sts.windows.net/{tenant_id}/",
    }


async def _get_jwk(kid: str) -> dict[str, Any]:
    """Return the JWK for *kid*, refreshing the JWKS set when stale or unknown."""
    settings = get_settings()
    async with _cache_lock:
        now = time.monotonic()
        if now < _cache_expiry and kid in _cache:
            return _cache[kid]
        await _refresh(settings)
        if kid not in _cache:
            raise ValueError(f"Unknown signing key id {kid!r} in Entra JWKS")
        return _cache[kid]


async def _refresh(settings) -> None:
    url = _jwks_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            resp = await c.get(url)
            resp.raise_for_status()
    except Exception as exc:
        raise RuntimeError(f"Failed to fetch Entra JWKS from {url}: {exc}") from exc
    _cache.clear()
    for k in resp.json().get("keys", []):
        _cache[k["kid"]] = k
    global _cache_expiry
    _cache_expiry = time.monotonic() + settings.entra_jwks_cache_seconds
    logger.debug("Entra JWKS refreshed, %d key(s) cached", len(_cache))


# ── Token verification ───────────────────────────────────────────────────────


async def verify_driver_api_token(token: str) -> dict[str, Any]:
    """Verify a Microsoft OBO access token whose aud is Driver API.

    Checks: RS256 signature via Entra JWKS, iss, aud, exp.
    Also requires scp (delegated token) and a user identity (oid or sub).

    Returns the verified claims dict on success.
    Raises ValueError on any verification failure.
    Raises RuntimeError if JWKS is unreachable.
    """
    settings = get_settings()

    if not settings.entra_tenant_id or not settings.entra_driver_api_audience:
        raise ValueError("Entra driver token verification not configured (ENTRA_TENANT_ID / ENTRA_DRIVER_API_AUDIENCE missing)")

    try:
        header = jose_jwt.get_unverified_header(token)
    except JWTError as exc:
        raise ValueError(f"Malformed token header: {exc}") from exc

    kid = header.get("kid")
    if not kid:
        raise ValueError("Token header missing kid")

    jwk = await _get_jwk(kid)
    public_key = RSAKey(jwk, algorithm="RS256")

    try:
        claims = jose_jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=settings.entra_driver_api_audience,
            options={"verify_iss": False},
        )
    except JWTError as exc:
        raise ValueError(f"Token verification failed: {exc}") from exc

    issuer = claims.get("iss")
    if issuer not in _allowed_issuers(settings.entra_tenant_id):
        raise ValueError(f"Token verification failed: Invalid issuer: {issuer!r}")

    if not claims.get("scp"):
        raise ValueError("Token is not a delegated (user) token — scp claim absent")

    if not (claims.get("oid") or claims.get("sub")):
        raise ValueError("Token missing user identity (oid/sub)")

    return claims
