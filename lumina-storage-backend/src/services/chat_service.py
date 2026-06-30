"""Shim (P8 W3): chat_service → src/domain/chat/chat_service.py."""
from src.domain.chat.chat_service import ChatService, citations_to_sources  # noqa: F401

__all__ = ["ChatService", "citations_to_sources"]
