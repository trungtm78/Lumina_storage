"""Shim (P8 W3): document service → src/domain/document/document.py.

Re-export TƯỜNG MINH MỌI symbol import từ ngoài (gồm private storage_config lazy multi-line import:
_DEFAULT_MAX_UPLOAD_SIZE_MB/_resolve_max_upload_size_mb) để import path cũ vẫn chạy tới khi gỡ shim.
"""
from src.domain.document.document import (  # noqa: F401
    DocumentService,
    _DEFAULT_MAX_UPLOAD_SIZE_MB,
    _resolve_max_upload_size_mb,
)

__all__ = ["DocumentService", "_DEFAULT_MAX_UPLOAD_SIZE_MB", "_resolve_max_upload_size_mb"]
