"""Phase 5b Task 1 — LocalHybridProvider bọc pipeline hiện tại (TextExtractionService +
parse_xlsx) sau interface ExtractionProvider. Zero-regression: extract == hành vi cũ.
"""
import unicodedata
from unittest.mock import patch

import pytest

from src.extraction.local_hybrid import LocalHybridProvider
from src.services.text_extraction_service import PageResult

pytestmark = pytest.mark.asyncio


def _provider():
    return LocalHybridProvider(gotenberg_url="", vlm_model="", vlm_kwargs={})


async def test_text_path_returns_nfc_pageresult():
    nfd = unicodedata.normalize("NFD", "Tiếng Việt có dấu")
    pages = await _provider().extract(nfd.encode("utf-8"), "text/plain", ".txt")
    assert pages and unicodedata.is_normalized("NFC", pages[0].text)
    assert pages[0].text == unicodedata.normalize("NFC", "Tiếng Việt có dấu")


async def test_excel_path_uses_parse_xlsx():
    fake = [PageResult(page_number=1, text="hàng 1", confidence=1.0)]
    with patch("src.extraction.local_hybrid.parse_xlsx_to_page_results", return_value=fake) as m:
        pages = await _provider().extract(b"xlsxbytes", "application/vnd.ms-excel", ".xlsx")
    m.assert_called_once()
    assert pages == fake


async def test_csv_routed_to_excel_path():
    fake = [PageResult(page_number=1, text="csv row", confidence=1.0)]
    with patch("src.extraction.local_hybrid.parse_xlsx_to_page_results", return_value=fake) as m:
        await _provider().extract(b"a,b\n1,2", "text/csv", ".csv")
    m.assert_called_once()


async def test_name_and_test_connection():
    prov = _provider()
    assert prov.name == "local_hybrid"
    ok, msg = await prov.test_connection()
    assert ok is True
