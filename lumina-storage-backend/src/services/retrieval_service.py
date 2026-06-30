"""Shim (P8 W3): retrieval_service → src/domain/chat/retrieval_service.py (document.py dùng)."""
from src.domain.chat.retrieval_service import RetrievalService, _rrf_fuse  # noqa: F401

__all__ = ["RetrievalService", "_rrf_fuse"]
