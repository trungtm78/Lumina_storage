"""Shim (Phase 8 W3 Task A): vector_service đã chuyển sang src/shared/.

VectorService (Qdrant) = shared kernel dùng XUYÊN domain (chat retrieval + document ingest).
Re-export TƯỜNG MINH mọi symbol public được import từ ngoài (KHÔNG `import *`) để import path
cũ vẫn chạy tới khi gỡ shim (Task 10). Xem plan W3 §Task A.
"""
from src.shared.vector_service import (  # noqa: F401
    ChunkPoint,
    SearchResult,
    VectorService,
)

__all__ = ["ChunkPoint", "SearchResult", "VectorService"]
