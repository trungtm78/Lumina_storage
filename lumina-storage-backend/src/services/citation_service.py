"""Shim (P8 W3): citation_service → src/domain/chat/citation_service.py."""
from src.domain.chat.citation_service import citation_to_source, citations_to_sources  # noqa: F401

__all__ = ["citation_to_source", "citations_to_sources"]
