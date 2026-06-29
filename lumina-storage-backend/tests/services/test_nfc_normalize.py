"""Phase 5a Task 2c — NFC normalize tiếng Việt khi trích xuất (T2).

PyMuPDF/VLM/MarkItDown có thể trả NFD (dấu tổ hợp) → so khớp/search lệch. extract() chuẩn
hóa NFC ở MỘT điểm cho mọi PageResult.
"""
import unicodedata

import pytest

from src.services.text_extraction_service import TextExtractionService


@pytest.mark.asyncio
async def test_plaintext_extract_is_nfc():
    nfd = unicodedata.normalize("NFD", "Tiếng Việt có dấu")
    assert not unicodedata.is_normalized("NFC", nfd)  # đầu vào là NFD
    svc = TextExtractionService(gotenberg_url="", vlm_model="", vlm_kwargs={})
    pages = await svc.extract(nfd.encode("utf-8"), "text/plain", ".txt")
    assert pages
    assert unicodedata.is_normalized("NFC", pages[0].text)
    assert pages[0].text == unicodedata.normalize("NFC", "Tiếng Việt có dấu")
