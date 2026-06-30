"""Shim (Phase 8 W3 Task A): BaseRepository đã chuyển sang src/shared/repositories/base.py.

Repository base dùng XUYÊN domain. Re-export TƯỜNG MINH (KHÔNG `import *`) để import path cũ vẫn
chạy tới khi gỡ shim. Module shared import Base từ src.shared.models.base (không trigger re-entrant).
Xem plan W3 §Task A.
"""
from src.shared.repositories.base import BaseRepository  # noqa: F401

__all__ = ["BaseRepository"]
