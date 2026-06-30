"""Logic phân quyền thuần (không phụ thuộc FastAPI/HTTP) — dùng chung api.deps lẫn services.

Tách khỏi src.api.deps để service không import NGƯỢC lên tầng api (Phase 6 layering).
"""
from src.models.user import User


def is_admin(user: User) -> bool:
    """User có role mặc định (admin)? Đọc thuần thuộc tính, không I/O."""
    return any(ur.role.is_default for ur in user.roles if ur.role is not None)
