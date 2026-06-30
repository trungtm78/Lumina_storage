import logging
import secrets
import uuid
from datetime import UTC, datetime
from typing import Annotated

import httpx
from arq import ArqRedis
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from jose import jwt as jose_jwt
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.authz import is_admin
from src.core.config import get_settings
from src.core.database import get_db
from src.core.exceptions import ForbiddenError, UnauthorizedError
from src.core.security import decode_token, hash_password
from src.models.user import User
from src.repositories.user import UserRepository

logger = logging.getLogger(__name__)

_bearer = HTTPBearer()
_settings = get_settings()
_sso_client = httpx.AsyncClient(timeout=5)


def _extract_entra_email_identity(claims: dict) -> str:
    """Return the best-effort user email from Entra claims."""
    for key in ("email", "preferred_username", "unique_name", "upn"):
        raw = str(claims.get(key) or "").strip().lower()
        if not raw:
            continue

        if "#" in raw:
            _, suffix = raw.split("#", 1)
            if "@" in suffix and "#" not in suffix:
                return suffix

        if "@" in raw:
            return raw

    return ""


async def _validate_sso_session(token: str, db: AsyncSession, token_iat: int = 0) -> User:
    """Gọi SSO service /validate, tìm hoặc tạo user local, trả về User."""
    if not _settings.lumina_sso_service_url:
        raise UnauthorizedError("SSO chưa được cấu hình")
    try:
        resp = await _sso_client.post(
            f"{_settings.lumina_sso_service_url}/auth/sso/validate",
            json={"session_token": token},
        )
        if resp.status_code != 200:
            reason = resp.json().get("reason", "unknown")
            raise UnauthorizedError(f"SSO session invalid: {reason}")
        data = resp.json()
    except UnauthorizedError:
        raise
    except httpx.RequestError:
        raise UnauthorizedError("Không thể kết nối SSO service")

    email: str = data.get("email", "").lower().strip()
    full_name: str = data.get("full_name", "")
    repo = UserRepository(db)
    user = await repo.get_by_email(email)
    if not user:
        base_username = email.split("@")[0]
        username = base_username
        if await repo.get_by_username(username):
            username = f"{base_username}_{secrets.token_hex(4)}"
        user = await repo.create({
            "email": email,
            "username": username,
            "full_name": full_name,
            "password": hash_password(secrets.token_hex(32)),
        })
    if not user.is_active:
        raise UnauthorizedError("User not active")

    session_iat = datetime.fromtimestamp(token_iat, tz=UTC)
    if user.last_login is None or session_iat > user.last_login:
        user.last_login = datetime.now(UTC)
        await db.flush()

    # Re-fetch với selectinload để tránh MissingGreenlet khi truy cập user.roles
    return await repo.get_by_id(user.id)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials

    # Phân biệt SSO session token (có keycloak_sub) và local JWT (có type=access)
    try:
        unverified = jose_jwt.get_unverified_claims(token)
    except JWTError:
        raise UnauthorizedError("Invalid token")

    if unverified.get("keycloak_sub"):
        return await _validate_sso_session(token, db, unverified.get("iat", 0))

    # Branch 2: Microsoft Entra OBO token (aud = Driver API)
    if _settings.entra_tenant_id and _settings.entra_driver_api_audience:
        unverified_aud = unverified.get("aud", "")
        aud_match = (
            unverified_aud == _settings.entra_driver_api_audience
            or (
                isinstance(unverified_aud, list)
                and _settings.entra_driver_api_audience in unverified_aud
            )
        )
        if aud_match:
            from src.auth.entra_driver import verify_driver_api_token

            try:
                verified = await verify_driver_api_token(token)
            except ValueError as exc:
                raise UnauthorizedError(str(exc))
            except RuntimeError as exc:
                logger.error("Entra JWKS unavailable: %s", exc)
                raise UnauthorizedError("Microsoft token verification temporarily unavailable")

            email = _extract_entra_email_identity(verified)
            if not email:
                raise UnauthorizedError("Microsoft token missing email identity (preferred_username/email)")

            try:
                return await UserRepository(db).get_or_provision_by_entra(
                    email=email,
                    full_name=verified.get("name", ""),
                )
            except PermissionError as exc:
                raise UnauthorizedError(str(exc))

    # Local JWT (email/password login)
    try:
        payload = decode_token(token)
    except ValueError:
        raise UnauthorizedError("Invalid token")

    if payload.get("type") != "access":
        raise UnauthorizedError("Invalid token type")

    user = await UserRepository(db).get_by_id(uuid.UUID(payload["sub"]))
    if not user or not user.is_active:
        raise UnauthorizedError("User not found or inactive")
    return user


# is_admin chuyển sang src.core.authz (logic thuần) — re-export giữ tương thích import cũ.


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not is_admin(current_user):
        raise ForbiddenError("Admin access required")
    return current_user


def get_arq_pool(request: Request) -> ArqRedis:
    return request.app.state.arq_pool


# Convenience type aliases for route signatures
CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_admin)]
