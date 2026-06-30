"""Shim (Phase 8 W3 Task A): embedding_service đã chuyển sang src/shared/.

EmbeddingService = shared kernel dùng XUYÊN domain (chat RAG + document ingest). Re-export
TƯỜNG MINH (KHÔNG `import *`) để import path cũ vẫn chạy tới khi gỡ shim (Task 10). Import nội bộ
của module đã trỏ src.shared (ai_model_config + tokenizer) → KHÔNG tạo edge shared→services.
Xem plan W3 §Task A.
"""
from src.shared.embedding_service import EmbeddingService  # noqa: F401

__all__ = ["EmbeddingService"]
