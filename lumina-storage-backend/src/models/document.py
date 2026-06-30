"""Shim (Phase 8 W3 Task A): document models đã chuyển sang src/shared/models/.

Document entity dùng XUYÊN domain (template LÀ document → generator/review/chat/worker). Re-export
TƯỜNG MINH MỌI model class (KHÔNG `import *`) để: (a) import path cũ `from src.models.document import
...` vẫn chạy; (b) src/models/__init__.py + Alembic `import src.models` vẫn đăng ký class lên
Base.metadata (class định nghĩa ở shared, import qua shim → register). Xem plan W3 §Task A.
"""
from src.shared.models.document import (  # noqa: F401
    Document,
    DocumentChunk,
    DocumentContent,
    DocumentPermission,
    DocumentTag,
    DocumentVersion,
    Folder,
    Tag,
)

__all__ = [
    "Document",
    "DocumentChunk",
    "DocumentContent",
    "DocumentPermission",
    "DocumentTag",
    "DocumentVersion",
    "Folder",
    "Tag",
]
