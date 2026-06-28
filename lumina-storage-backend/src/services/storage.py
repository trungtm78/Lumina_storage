import asyncio
import hashlib
import os
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO

import boto3
from botocore.config import Config as BotoConfig

from src.core.config import get_settings
from src.core.encryption import decrypt_config_secrets
from src.models.storage import StorageConfig


@dataclass
class StorageResult:
    file_path: str
    file_name: str
    checksum: str
    file_size: int


class StorageBackend(ABC):
    @abstractmethod
    async def save(self, file_data: bytes | BinaryIO, filename: str) -> StorageResult:
        ...

    @abstractmethod
    async def delete(self, file_path: str) -> None:
        ...

    @abstractmethod
    async def read(self, file_path: str) -> bytes:
        ...

    @abstractmethod
    async def list_files(self) -> list[str]:
        """Return all file paths (relative, backend-rooted) stored in this backend."""
        ...

    def _generate_path(self, filename: str) -> tuple[str, str]:
        """Generate a storage path and stored filename.

        Returns (relative_path, stored_filename).
        Path pattern: {YYYY}/{MM}/{uuid4}.{ext}
        """
        now = datetime.now(UTC)
        ext = Path(filename).suffix.lower()
        stored_name = f"{uuid.uuid4()}{ext}"
        relative_dir = f"{now.year}/{now.month:02d}"
        relative_path = f"{relative_dir}/{stored_name}"
        return relative_path, stored_name

    def _compute_checksum(self, data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()


class LocalStorageBackend(StorageBackend):
    def __init__(self, base_dir: str) -> None:
        self.base_dir = Path(base_dir)

    async def save(self, file_data: bytes | BinaryIO, filename: str) -> StorageResult:
        if isinstance(file_data, BinaryIO) or hasattr(file_data, "read"):
            data = file_data.read() if isinstance(file_data.read(), bytes) else file_data.read()
        else:
            data = file_data

        relative_path, stored_name = self._generate_path(filename)
        full_path = self.base_dir / relative_path

        def _write() -> None:
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_bytes(data)

        await asyncio.to_thread(_write)

        return StorageResult(
            file_path=relative_path,
            file_name=stored_name,
            checksum=self._compute_checksum(data),
            file_size=len(data),
        )

    async def delete(self, file_path: str) -> None:
        full_path = self.base_dir / file_path

        def _delete() -> None:
            if full_path.exists():
                full_path.unlink()

        await asyncio.to_thread(_delete)

    async def read(self, file_path: str) -> bytes:
        full_path = self.base_dir / file_path

        def _read() -> bytes:
            return full_path.read_bytes()

        return await asyncio.to_thread(_read)

    async def list_files(self) -> list[str]:
        """Walk the base_dir and return all files as relative paths."""
        def _walk() -> list[str]:
            if not self.base_dir.exists():
                return []
            paths: list[str] = []
            for p in self.base_dir.rglob("*"):
                if p.is_file():
                    rel = p.relative_to(self.base_dir).as_posix()
                    paths.append(rel)
            return paths

        return await asyncio.to_thread(_walk)


class S3StorageBackend(StorageBackend):
    def __init__(
        self,
        bucket: str,
        access_key: str,
        secret_key: str,
        region: str = "us-east-1",
        endpoint_url: str | None = None,
    ) -> None:
        self.bucket = bucket
        self._client = boto3.client(
            "s3",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            endpoint_url=endpoint_url,
            config=BotoConfig(signature_version="s3v4"),
        )

    async def save(self, file_data: bytes | BinaryIO, filename: str) -> StorageResult:
        if isinstance(file_data, BinaryIO) or hasattr(file_data, "read"):
            data = file_data.read() if isinstance(file_data.read(), bytes) else file_data.read()
        else:
            data = file_data

        relative_path, stored_name = self._generate_path(filename)

        await asyncio.to_thread(
            self._client.put_object,
            Bucket=self.bucket,
            Key=relative_path,
            Body=data,
        )

        return StorageResult(
            file_path=relative_path,
            file_name=stored_name,
            checksum=self._compute_checksum(data),
            file_size=len(data),
        )

    async def delete(self, file_path: str) -> None:
        await asyncio.to_thread(
            self._client.delete_object,
            Bucket=self.bucket,
            Key=file_path,
        )

    async def read(self, file_path: str) -> bytes:
        response = await asyncio.to_thread(
            self._client.get_object,
            Bucket=self.bucket,
            Key=file_path,
        )
        return response["Body"].read()

    async def list_files(self) -> list[str]:
        """List all object keys in the bucket (paginated)."""
        def _list() -> list[str]:
            paginator = self._client.get_paginator("list_objects_v2")
            keys: list[str] = []
            for page in paginator.paginate(Bucket=self.bucket):
                for obj in page.get("Contents", []) or []:
                    keys.append(obj["Key"])
            return keys

        return await asyncio.to_thread(_list)


def get_storage_backend(config: StorageConfig) -> StorageBackend:
    """Create a StorageBackend from a StorageConfig model."""
    # Secret S3 (access_key/secret_key) được lưu mã hóa trong JSONB → giải mã
    # ngay trước khi dựng backend. Field không phải secret giữ nguyên.
    cfg = decrypt_config_secrets(config.config or {})

    if config.backend_type == "local":
        # Default "uploads" matches the docker-compose volume mount. Admin can
        # override by setting `base_path` or `base_dir` in the storage config JSONB.
        base_dir = cfg.get("base_dir") or cfg.get("base_path") or "uploads"
        # Resolve relative paths against the project root to avoid cwd issues (e.g. worker)
        base_path = Path(base_dir)
        if not base_path.is_absolute():
            base_path = Path(__file__).resolve().parent.parent.parent / base_dir
        return LocalStorageBackend(base_dir=str(base_path))

    if config.backend_type in ("s3", "minio"):
        return S3StorageBackend(
            bucket=cfg.get("bucket") or cfg.get("bucket_name", ""),
            access_key=cfg["access_key"],
            secret_key=cfg["secret_key"],
            region=cfg.get("region") or cfg.get("region_name") or "garage",
            endpoint_url=cfg.get("endpoint_url"),
        )

    raise ValueError(f"Unsupported storage backend: {config.backend_type}")
