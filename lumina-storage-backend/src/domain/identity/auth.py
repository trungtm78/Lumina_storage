import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import ConflictError, UnauthorizedError
from src.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from src.models.user import User
from src.repositories.user import UserRepository
from src.schemas.auth import LoginRequest, RegisterRequest, TokenPair, UserResponse


@dataclass
class LoginResult:
    tokens: TokenPair
    must_change_password: bool


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = UserRepository(session)
        self.session = session

    async def register(self, data: RegisterRequest) -> UserResponse:
        if await self.repo.get_by_username(data.username):
            raise ConflictError("Username already taken")
        if await self.repo.get_by_email(data.email):
            raise ConflictError("Email already registered")

        user = await self.repo.create(
            {
                "username": data.username,
                "email": data.email,
                "full_name": data.full_name,
                "password": hash_password(data.password),
            }
        )
        return UserResponse.model_validate(user)

    async def login(self, data: LoginRequest) -> LoginResult:
        user = await self.repo.get_by_username_or_email(data.username)
        if not user:
            raise UnauthorizedError("Invalid credentials")
        if not verify_password(data.password, user.password):
            raise UnauthorizedError("Invalid credentials")
        if not user.is_active:
            raise UnauthorizedError("Account is inactive")

        user.last_login = datetime.now(UTC)
        await self.session.flush()

        payload = {"sub": str(user.id)}
        tokens = TokenPair(
            access_token=create_access_token(payload),
            refresh_token=create_refresh_token(payload),
        )
        return LoginResult(tokens=tokens, must_change_password=bool(user.force_change_password))

    async def change_password(self, user: User, current_password: str, new_password: str) -> None:
        if not verify_password(current_password, user.password):
            raise UnauthorizedError("Current password is incorrect")
        if verify_password(new_password, user.password):
            raise UnauthorizedError("New password must be different from the current one")
        user.password = hash_password(new_password)
        user.force_change_password = False
        await self.session.flush()

    async def refresh(self, refresh_token: str) -> TokenPair:
        try:
            payload = decode_token(refresh_token)
        except ValueError:
            raise UnauthorizedError("Invalid refresh token")

        if payload.get("type") != "refresh":
            raise UnauthorizedError("Invalid token type")

        user = await self.repo.get_by_id(uuid.UUID(payload["sub"]))
        if not user or not user.is_active:
            raise UnauthorizedError("User not found or inactive")

        new_payload = {"sub": str(user.id)}
        return TokenPair(
            access_token=create_access_token(new_payload),
            refresh_token=create_refresh_token(new_payload),
        )
