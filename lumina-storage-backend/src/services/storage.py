"""Shim (P8 W3): storage backends → src/shared/storage.py (cross-cutting infra: get_storage_backend dùng xuyên domain)."""
from src.shared.storage import (  # noqa: F401
    LocalStorageBackend,
    S3StorageBackend,
    StorageBackend,
    StorageResult,
    get_storage_backend,
)

__all__ = ["LocalStorageBackend", "S3StorageBackend", "StorageBackend", "StorageResult", "get_storage_backend"]
