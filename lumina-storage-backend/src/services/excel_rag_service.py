"""Shim (P8 W3): excel_rag_service → src/domain/chat/excel_rag_service.py (extraction/local_hybrid dùng)."""
from src.domain.chat.excel_rag_service import parse_xlsx_to_page_results  # noqa: F401

__all__ = ["parse_xlsx_to_page_results"]
