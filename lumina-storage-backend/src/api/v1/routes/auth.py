from fastapi import APIRouter, Cookie, Depends, Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import get_current_user, require_admin
from src.core.config import get_settings
from src.core.database import get_db
from src.core.exceptions import UnauthorizedError
from src.core.security import REFRESH_TOKEN_EXPIRE_DAYS
from src.core.security import create_access_token, create_refresh_token
from src.models.user import User
from src.repositories.user import UserRepository
from src.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    MeResponse,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from src.services.auth import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])

_REFRESH_COOKIE = "refresh_token"
_settings = get_settings()
_COOKIE_MAX_AGE = REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
_COOKIE_SECURE = _settings.app_env == "production"

# Per-IP rate limiter shared with the FastAPI app via main.py.
# 10/minute on /login keeps brute-force pressure low; tune this constant if a
# specific deployment needs to be stricter or more permissive.
_LOGIN_RATE_LIMIT = "10/minute"
limiter = Limiter(key_func=get_remote_address)


def _set_refresh_cookie(response: Response, token: str) -> None:
    same_site = "none" if _COOKIE_SECURE else "lax"
    response.set_cookie(
        key=_REFRESH_COOKIE,
        value=token,
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite=same_site,
        max_age=_COOKIE_MAX_AGE,
        path="/",
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=_REFRESH_COOKIE, path="/")


@router.post("/register", response_model=UserResponse, status_code=201)
async def register(
    data: RegisterRequest,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> UserResponse:
    """Admin-only: create a new user account.

    Self-registration is intentionally not supported — accounts are provisioned
    by administrators through the user-management UI. The endpoint name stays
    `/auth/register` for frontend compatibility, but the require_admin gate is
    the authoritative access control.
    """
    return await AuthService(db).register(data)


@router.post("/login", response_model=TokenResponse)
@limiter.limit(_LOGIN_RATE_LIMIT)
async def login(
    request: Request,
    data: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    _clear_refresh_cookie(response)
    result = await AuthService(db).login(data)
    _set_refresh_cookie(response, result.tokens.refresh_token)
    return TokenResponse(
        access_token=result.tokens.access_token,
        must_change_password=result.must_change_password,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    response: Response,
    db: AsyncSession = Depends(get_db),
    refresh_token: str | None = Cookie(default=None, alias=_REFRESH_COOKIE),
) -> TokenResponse:
    if not refresh_token:
        raise UnauthorizedError("Refresh token missing")
    try:
        tokens = await AuthService(db).refresh(refresh_token)
    except UnauthorizedError:
        _clear_refresh_cookie(response)
        raise
    _set_refresh_cookie(response, tokens.refresh_token)
    return TokenResponse(access_token=tokens.access_token)


@router.post("/logout", status_code=204)
async def logout(response: Response) -> None:
    _clear_refresh_cookie(response)


@router.post("/change-password", status_code=204)
@limiter.limit("5/minute")
async def change_password(
    request: Request,
    data: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await AuthService(db).change_password(
        current_user, data.current_password, data.new_password
    )


@router.get("/me", response_model=MeResponse)
async def me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeResponse:
    user = await UserRepository(db).get_by_id_with_permissions(current_user.id)
    return MeResponse.model_validate(user)
