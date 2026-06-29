"""Phase 5a Task 2d — multi-page chunk theo câu ~1800 giữ page_number (T3/R9).

Bỏ mặc định "1 trang = 1 chunk ≤24000": mỗi page chunk_by_sentences ~1800; table-heavy
(char-ratio dòng markdown table cột-0 ≥ 0.5) giữ _split_table_by_rows (KHÔNG cắt giữa hàng).
"""
from src.services.text_extraction_service import PageResult
from src.worker.tasks.document import _chunk_pages


def test_multipage_splits_dense_page_keeping_page_number():
    text = ". ".join(f"Câu số {i} có nội dung dài vừa phải để tạo nhiều token" for i in range(300)) + "."
    pages = [PageResult(page_number=7, text=text, confidence=1.0)]
    chunks = _chunk_pages(pages)
    assert len(chunks) > 1  # page dày → nhiều chunk (không còn 1 page = 1 chunk)
    assert all(pn == 7 for pn, _ in chunks)  # giữ page_number gốc
    assert all(len(c) <= 2600 for _, c in chunks)  # ~1800 + overlap, không khổng lồ


def test_table_heavy_page_not_cut_midrow():
    rows = "\n".join(f"| a{i} | b{i} |" for i in range(300))
    table = "| col1 | col2 |\n|---|---|\n" + rows
    pages = [PageResult(page_number=1, text=table, confidence=1.0)]
    chunks = _chunk_pages(pages)
    assert len(chunks) >= 1
    # Mỗi dòng data giữ NGUYÊN hàng (| aN | bN | = 3 dấu |), không bị cắt giữa hàng.
    for _, c in chunks:
        for line in c.splitlines():
            if line.startswith("| a"):
                assert line.count("|") == 3


def test_mixed_prose_small_table_uses_sentence_chunking():
    # codex P2: page chủ yếu prose + bảng nhỏ (ratio table < 0.5) → KHÔNG table-heavy →
    # chunk theo câu (không route nhầm sang row-split làm mất chunk ~1800).
    prose = ". ".join(f"Câu prose số {i} đủ dài để tạo nhiều token nội dung" for i in range(200)) + "."
    table = "| a | b |\n|---|---|\n| 1 | 2 |"
    pages = [PageResult(page_number=3, text=prose + "\n" + table, confidence=1.0)]
    chunks = _chunk_pages(pages)
    assert len(chunks) > 1  # sentence-chunked, không phải 1 row-group chunk khổng lồ


def test_short_page_single_chunk():
    pages = [PageResult(page_number=2, text="Một câu ngắn.", confidence=1.0)]
    chunks = _chunk_pages(pages)
    assert chunks == [(2, "Một câu ngắn.")]
