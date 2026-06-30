"""Shim (Phase 8 W3 Task A): DocumentPermissionService đã chuyển sang src/shared/.

ACL = shared kernel dùng xuyên domain (document/chat/review/generator/folder/dashboard/skill).
Re-export TƯỜNG MINH (KHÔNG `import *` — giữ được symbol private nếu sau này có) để mọi import
path cũ `from src.services.document_permission import DocumentPermissionService` vẫn chạy tới khi
gỡ shim (Task 10). Xem plan W3 §Task A.
"""
from src.shared.document_permission import DocumentPermissionService  # noqa: F401

__all__ = ["DocumentPermissionService"]
