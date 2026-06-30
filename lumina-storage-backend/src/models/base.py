"""Shim (Phase 8 W3 Task A): Base/TimestampMixin đã chuyển sang src/shared/models/base.py.

Base (DeclarativeBase, sở hữu Base.metadata dùng chung) đặt ở shared để model ở src/shared/models/
import Base TỪ shared — KHÔNG trigger src.models.__init__ (gỡ re-entrant import codex P2). Re-export
TƯỜNG MINH cùng Base object → MỌI model (cũ qua shim này + mới qua shared) register CÙNG metadata.
Xem plan W3 §Task A.
"""
from src.shared.models.base import Base, TimestampMixin  # noqa: F401

__all__ = ["Base", "TimestampMixin"]
