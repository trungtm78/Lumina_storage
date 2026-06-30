"""Shim (P8 W3 Task A): document repositories → src/shared/repositories/document.py (cross-domain data layer)."""
from src.shared.repositories.document import (  # noqa: F401
    DocumentRepository,
    FolderRepository,
    StorageConfigRepository,
    _HIDDEN_SOURCE_TYPES,
)

__all__ = ["DocumentRepository", "FolderRepository", "StorageConfigRepository", "_HIDDEN_SOURCE_TYPES"]
