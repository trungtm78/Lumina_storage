import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.encryption import (
    STORAGE_SECRET_FIELDS,
    encrypt_config_secrets,
    is_masked,
)
from src.core.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from src.models.user import User
from src.repositories.document import StorageConfigRepository
from src.schemas.document import (
    StorageConfigCreateRequest,
    StorageConfigResponse,
    StorageConfigUpdateRequest,
    UserStorageConfigCreateRequest,
    StorageConnectionTestRequest,
)

import boto3
from botocore.exceptions import ClientError


VALID_BACKEND_TYPES = {"local", "s3", "minio"}


class StorageConfigService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = StorageConfigRepository(session)

    @staticmethod
    def _prepare_config(
        new_config: dict | None, existing: dict | None = None
    ) -> dict | None:
        """Mã hóa secret trước khi lưu JSONB.

        CHỈ khi giá trị secret đến từ FE là sentinel đã mask (round-trip của response
        redact) thì giữ nguyên secret gốc đang lưu — tránh ghi đè secret thật bằng mask.
        Field thiếu/rỗng/giá trị mới được tôn trọng nguyên ý FE: cho phép XÓA secret hoặc
        đổi backend (vd S3→local) mà không để sót credential cũ trong JSONB.
        """
        if not new_config:
            return new_config
        merged = dict(new_config)
        existing = existing or {}
        for f in STORAGE_SECRET_FIELDS:
            if is_masked(merged.get(f)):
                # Round-trip giá trị đã redact → khôi phục secret gốc (nếu có),
                # nếu không có thì bỏ sentinel (không lưu mask làm secret).
                if f in existing:
                    merged[f] = existing[f]
                else:
                    merged.pop(f, None)
        return encrypt_config_secrets(merged)

    # --- Connection Testing ---

    async def test_connection(self, req: StorageConnectionTestRequest) -> dict:
        if req.backend_type == "local":
            import os
            base_path = req.config.get("base_path") or req.config.get("base_dir") or "uploads"
            try:
                os.makedirs(base_path, exist_ok=True)
                test_file = os.path.join(base_path, ".test")
                with open(test_file, "w") as f:
                    f.write("test")
                os.remove(test_file)
                return {"success": True, "message": "Local folder accessible"}
            except BaseException as e:
                return {"success": False, "message": f"Folder access error: {str(e)}"}

        elif req.backend_type in ["s3", "minio"]:
            import asyncio
            import urllib3
            from botocore.client import Config

            access_key = req.config.get("access_key")
            secret_key = req.config.get("secret_key")
            endpoint_url = req.config.get("endpoint_url")
            bucket = req.config.get("bucket_name") or req.config.get("bucket")
            region = req.config.get("region") or req.config.get("region_name") or "garage"
            if not all([access_key, secret_key, endpoint_url, bucket]):
                return {"success": False, "message": "S3 missing required configuration (keys, endpoint, bucket)"}

            def _test():
                s3_client = boto3.client(
                    "s3",
                    aws_access_key_id=access_key,
                    aws_secret_access_key=secret_key,
                    endpoint_url=endpoint_url,
                    region_name=region,
                    config=Config(
                        s3={'addressing_style': 'path'},
                        signature_version='s3v4'
                    )
                )
                # Test bucket existence / list permission
                try:
                    s3_client.head_bucket(Bucket=bucket)
                except ClientError as e:
                    error_code = e.response.get("Error", {}).get("Code")
                    if error_code == "404":
                        return {"success": False, "message": f"Bucket '{bucket}' not found"}
                    elif error_code == "403":
                        return {"success": False, "message": f"Access denied to bucket '{bucket}'"}
                    return {"success": False, "message": str(e)}

                # Also test put and get object
                test_key = ".lumina-test"
                try:
                    s3_client.put_object(Bucket=bucket, Key=test_key, Body=b"test")
                    s3_client.delete_object(Bucket=bucket, Key=test_key)
                    return {"success": True, "message": "Connection successful"}
                except BaseException as e:
                    return {"success": False, "message": f"Write test failed: {str(e)}"}

            try:
                # Disable urllib3 warnings about unverified HTTPS if testing directly
                urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
                return await asyncio.to_thread(_test)
            except BaseException as e:
                return {"success": False, "message": f"Connection error: {str(e)}"}

        return {"success": False, "message": "Unknown backend_type"}

    async def get_upload_limits(self) -> dict:
        """Giới hạn dung lượng/file hiệu lực từ storage config mặc định (public)."""
        # Import nội bộ tránh vòng phụ thuộc service↔service ở thời điểm import module.
        from src.services.document import (
            _DEFAULT_MAX_UPLOAD_SIZE_MB,
            _resolve_max_upload_size_mb,
        )
        config = await self.repo.get_default()
        max_mb = _resolve_max_upload_size_mb(config) if config else _DEFAULT_MAX_UPLOAD_SIZE_MB
        return {"max_upload_size_mb": max_mb}

    # --- Admin (system-wide) ---

    async def create_config(self, data: StorageConfigCreateRequest) -> StorageConfigResponse:
        if data.backend_type not in VALID_BACKEND_TYPES:
            raise BadRequestError(f"Invalid backend_type. Must be one of: {', '.join(VALID_BACKEND_TYPES)}")

        if data.is_default:
            await self.repo.clear_default()

        payload = data.model_dump()
        payload["config"] = self._prepare_config(payload.get("config"))
        config = await self.repo.create(payload)
        return StorageConfigResponse.model_validate(config)

    async def list_configs(self) -> list[StorageConfigResponse]:
        configs = await self.repo.get_active_list()
        return [StorageConfigResponse.model_validate(c) for c in configs]

    async def update_config(
        self, config_id: uuid.UUID, data: StorageConfigUpdateRequest
    ) -> StorageConfigResponse:
        config = await self.repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("Storage config not found")

        if data.backend_type and data.backend_type not in VALID_BACKEND_TYPES:
            raise BadRequestError(f"Invalid backend_type. Must be one of: {', '.join(VALID_BACKEND_TYPES)}")

        for key, value in data.model_dump(exclude_none=True).items():
            if key == "config":
                value = self._prepare_config(value, existing=config.config)
            setattr(config, key, value)

        return StorageConfigResponse.model_validate(config)

    async def delete_config(self, config_id: uuid.UUID) -> None:
        config = await self.repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("Storage config not found")
        if config.is_default:
            raise BadRequestError("Cannot delete the default storage config")
        config.is_active = False

    async def set_default(self, config_id: uuid.UUID) -> StorageConfigResponse:
        config = await self.repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("Storage config not found")
        if not config.is_active:
            raise BadRequestError("Cannot set inactive config as default")

        await self.repo.clear_default()
        config.is_default = True
        return StorageConfigResponse.model_validate(config)

    # --- User (personal) ---

    async def create_user_config(
        self, data: UserStorageConfigCreateRequest, owner: User
    ) -> StorageConfigResponse:
        if data.backend_type not in VALID_BACKEND_TYPES:
            raise BadRequestError(f"Invalid backend_type. Must be one of: {', '.join(VALID_BACKEND_TYPES)}")

        payload = data.model_dump()
        payload["config"] = self._prepare_config(payload.get("config"))
        config = await self.repo.create({
            **payload,
            "owner_id": owner.id,
        })
        return StorageConfigResponse.model_validate(config)

    async def list_user_configs(self, owner: User) -> list[StorageConfigResponse]:
        configs = await self.repo.get_available_for_user(owner.id)
        return [StorageConfigResponse.model_validate(c) for c in configs]

    async def update_user_config(
        self, config_id: uuid.UUID, data: StorageConfigUpdateRequest, owner: User
    ) -> StorageConfigResponse:
        config = await self.repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("Storage config not found")
        if config.owner_id != owner.id:
            raise ForbiddenError("Cannot update another user's storage config")

        if data.backend_type and data.backend_type not in VALID_BACKEND_TYPES:
            raise BadRequestError(f"Invalid backend_type. Must be one of: {', '.join(VALID_BACKEND_TYPES)}")

        for key, value in data.model_dump(exclude_none=True).items():
            if key == "config":
                value = self._prepare_config(value, existing=config.config)
            setattr(config, key, value)

        return StorageConfigResponse.model_validate(config)

    async def delete_user_config(self, config_id: uuid.UUID, owner: User) -> None:
        config = await self.repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("Storage config not found")
        if config.owner_id != owner.id:
            raise ForbiddenError("Cannot delete another user's storage config")
        config.is_active = False
