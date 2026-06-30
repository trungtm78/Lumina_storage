"""Phase 5b — service ExtractionProviderConfig (mirror AIModelConfigService).

CRUD + set_default (clear+set MỘT transaction, commit ở boundary) + test_config (dựng
provider qua registry.from_config rồi test_connection). api_key mã hóa at-rest qua
EncryptedString (tầng ORM, không cần xử lý ở service).
"""
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import get_settings
from src.core.exceptions import NotFoundError
from src.extraction.registry import get_provider_class
from src.repositories.extraction_provider_config import ExtractionProviderConfigRepository
from src.schemas.extraction_provider_config import (
    ExtractionProviderConfigCreateRequest,
    ExtractionProviderConfigResponse,
    ExtractionProviderConfigTestRequest,
    ExtractionProviderConfigTestResponse,
    ExtractionProviderConfigUpdateRequest,
)


class ExtractionProviderConfigService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = ExtractionProviderConfigRepository(db)

    async def create(
        self, data: ExtractionProviderConfigCreateRequest
    ) -> ExtractionProviderConfigResponse:
        if data.is_default:
            await self.repo.clear_default()  # một default toàn cục
        config = await self.repo.create(data.model_dump())
        return ExtractionProviderConfigResponse.model_validate(config)

    async def get_by_id(self, config_id: uuid.UUID) -> ExtractionProviderConfigResponse:
        config = await self.repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("Extraction provider config not found")
        return ExtractionProviderConfigResponse.model_validate(config)

    async def list_all(self) -> list[ExtractionProviderConfigResponse]:
        return [ExtractionProviderConfigResponse.model_validate(c) for c in await self.repo.list_all()]

    async def list_active(self) -> list[ExtractionProviderConfigResponse]:
        return [ExtractionProviderConfigResponse.model_validate(c) for c in await self.repo.list_active()]

    async def update(
        self, config_id: uuid.UUID, data: ExtractionProviderConfigUpdateRequest
    ) -> ExtractionProviderConfigResponse:
        config = await self.repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("Extraction provider config not found")
        update_data = {k: v for k, v in data.model_dump().items() if v is not None}
        updated = await self.repo.update(config_id, update_data)
        return ExtractionProviderConfigResponse.model_validate(updated)

    async def delete(self, config_id: uuid.UUID) -> None:
        config = await self.repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("Extraction provider config not found")
        await self.repo.delete(config_id)

    async def set_default(self, config_id: uuid.UUID) -> ExtractionProviderConfigResponse:
        config = await self.repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("Extraction provider config not found")
        await self.repo.clear_default()  # atomic: clear + set MỘT transaction (boundary commit)
        updated = await self.repo.update(config_id, {"is_default": True})
        return ExtractionProviderConfigResponse.model_validate(updated)

    async def test_config(
        self, data: ExtractionProviderConfigTestRequest
    ) -> ExtractionProviderConfigTestResponse:
        cls = get_provider_class(data.provider)
        if cls is None:
            return ExtractionProviderConfigTestResponse(
                success=False, message=f"Provider '{data.provider}' chưa được hỗ trợ/đăng ký (thiếu SDK?)"
            )
        api_key = data.api_key
        if not api_key and data.config_id:
            stored = await self.repo.get_by_id(data.config_id)
            if stored:
                api_key = stored.api_key  # EncryptedString → đã giải mã
        try:
            provider = cls.from_config(
                settings=get_settings(), api_key=api_key, base_url=data.base_url, options=data.options,
            )
            ok, msg = await provider.test_connection()
            return ExtractionProviderConfigTestResponse(success=ok, message=msg)
        except Exception as e:  # noqa: BLE001 — test-connection báo lỗi cho admin
            return ExtractionProviderConfigTestResponse(success=False, message=str(e)[:300])
