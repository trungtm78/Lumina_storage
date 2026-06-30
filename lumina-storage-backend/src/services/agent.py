"""Shim (P8 W3): agent → src/domain/chat/agent.py (build_model dùng bởi ai/gateway; _jail_path/Citation bởi test)."""
from src.domain.chat.agent import Citation, _jail_path, build_model  # noqa: F401

__all__ = ["Citation", "_jail_path", "build_model"]
