from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import ConflictError, NotFoundError
from src.models.user import User
from src.repositories.system import SystemConfigRepository
from src.schemas.system import (
    PublicConfigResponse,
    SystemConfigCreateRequest,
    SystemConfigResponse,
    SystemConfigUpdateRequest,
)


class SystemConfigService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = SystemConfigRepository(session)

    async def create(
        self, data: SystemConfigCreateRequest, admin: User
    ) -> SystemConfigResponse:
        if await self.repo.get_by_key(data.key):
            raise ConflictError(f"Config key '{data.key}' already exists")

        config = await self.repo.create({
            **data.model_dump(),
            "updated_by_id": admin.id,
        })
        return SystemConfigResponse.model_validate(config)

    async def get_by_key(self, key: str) -> SystemConfigResponse:
        config = await self.repo.get_by_key(key)
        if not config:
            raise NotFoundError(f"Config key '{key}' not found")
        return SystemConfigResponse.model_validate(config)

    async def list_all(self) -> list[SystemConfigResponse]:
        configs = await self.repo.get_all_configs()
        return [SystemConfigResponse.model_validate(c) for c in configs]

    async def list_public(self) -> list[PublicConfigResponse]:
        configs = await self.repo.get_public_configs()
        return [PublicConfigResponse.model_validate(c) for c in configs]

    async def update(
        self, key: str, data: SystemConfigUpdateRequest, admin: User
    ) -> SystemConfigResponse:
        config = await self.repo.get_by_key(key)
        if not config:
            raise NotFoundError(f"Config key '{key}' not found")

        for field, val in data.model_dump(exclude_none=True).items():
            setattr(config, field, val)
        config.updated_by_id = admin.id
        config.updated_at = datetime.now(UTC)
        await self.repo.session.flush()

        return SystemConfigResponse.model_validate(config)

    async def delete(self, key: str) -> None:
        config = await self.repo.get_by_key(key)
        if not config:
            raise NotFoundError(f"Config key '{key}' not found")
        await self.repo.delete(config.id)
