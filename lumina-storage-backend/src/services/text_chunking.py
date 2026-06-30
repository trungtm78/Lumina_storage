"""Shim (P8 W3): text_chunking → src/domain/document/text_chunking.py (worker)."""
from src.domain.document.text_chunking import chunk_by_sentences  # noqa: F401

__all__ = ["chunk_by_sentences"]
