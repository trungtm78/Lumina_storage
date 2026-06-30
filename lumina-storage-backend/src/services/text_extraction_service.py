"""Shim (P8 W3): text_extraction_service → src/domain/document/text_extraction_service.py (extraction infra/worker dùng)."""
from src.domain.document.text_extraction_service import PageResult, TextExtractionService, _nfc  # noqa: F401

__all__ = ["PageResult", "TextExtractionService", "_nfc"]
