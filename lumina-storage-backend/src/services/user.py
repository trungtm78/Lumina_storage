"""Shim (P8 W3): UserService → src/domain/identity/user.py."""
from src.domain.identity.user import UserService  # noqa: F401

__all__ = ["UserService"]
