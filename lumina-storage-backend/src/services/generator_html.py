"""Phase 8 — helper thao tác HTML cho generator (tách khỏi route generator.py).

Gồm 3 nhóm:
- Manual-edit (WYSIWYG) → file: substitute field, wrap document, HTML→PDF/DOCX
  (qua Gotenberg hoặc htmldocx fallback), normalize bảng cho htmldocx.
- AI đề xuất chỉnh sửa block-based: parse block chứa-text, áp op, sanitize allowlist,
  dựng diff inline (track-changes), structural guard.

Hai hàm async (`_html_to_pdf_bytes`/`_html_to_docx_via_gotenberg`) có side-effect HTTP
gọi Gotenberg và raise HTTPException khi lỗi — phần còn lại là pure HTML transform.
"""
from __future__ import annotations

from io import BytesIO
from typing import TYPE_CHECKING

from fastapi import HTTPException

if TYPE_CHECKING:
    from src.schemas.generator import BlockEditOp


# ── Manual-edit (WYSIWYG) → file: helpers dùng cho nhánh edited_html ──────────

DOCX_HTML_CSS = """
body { font-family: 'Times New Roman', serif; color: #111; font-size: 13px; line-height: 1.6; }
.docx-html-preview { max-width: 820px; margin: 0 auto; padding: 24px; }
.docx-html-preview p { margin: 0 0 8px; }
.docx-html-preview table { border-collapse: collapse; width: 100%; margin: 8px 0; }
.docx-html-preview td, .docx-html-preview th { border: 1px solid #999; padding: 4px 8px; vertical-align: top; }
.docx-html-preview strong, .docx-html-preview b { font-weight: 700; }
.docx-html-preview h1 { font-size: 18px; font-weight: 700; margin: 12px 0; }
.docx-html-preview h2 { font-size: 15px; font-weight: 700; margin: 10px 0; }
"""


def _substitute_fields_html(html_body: str, field_values: dict) -> str:
    """Thay {key} → giá trị (escape) trong HTML đã sửa. Token chưa điền giữ nguyên."""
    import html as _html

    out = html_body
    for key, value in (field_values or {}).items():
        if value is None:
            continue
        sval = str(value)
        if not sval.strip():
            continue
        out = out.replace("{" + key + "}", _html.escape(sval))
    return out


def _wrap_html_document(body_html: str) -> str:
    return (
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        f"<style>{DOCX_HTML_CSS}</style></head>"
        f'<body class="docx-html-preview">{body_html}</body></html>'
    )


async def _html_to_pdf_bytes(full_html: str, gotenberg_url: str) -> bytes:
    import httpx

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{gotenberg_url}/forms/chromium/convert/html",
            files={"files": ("index.html", full_html.encode("utf-8"), "text/html")},
            data={"paperFormat": "A4"},
        )
    if resp.status_code != 200:
        raise HTTPException(502, "HTML→PDF conversion failed")
    return resp.content


def _normalize_html_tables(html: str) -> str:
    """Flatten colspan/rowspan and equalise row widths so htmldocx never crashes.

    htmldocx counts raw <td>/<th> tags to size its python-docx table, ignoring
    colspan entirely.  If any row has more effective columns than the first row
    (which sets the table width), cell() raises IndexError.  Fix:
    1. Expand every colspan-N cell into N plain <td> cells.
    2. Strip rowspan (htmldocx ignores it anyway).
    3. Pad every row to the same column count.
    Uses only direct-child rows to avoid touching nested tables.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    for table in soup.find_all("table"):
        # Collect direct rows only (skip nested-table rows)
        direct_rows: list = []
        for child in table.children:
            if not hasattr(child, "name"):
                continue
            if child.name == "tr":
                direct_rows.append(child)
            elif child.name in ("thead", "tbody", "tfoot"):
                direct_rows.extend(child.find_all("tr", recursive=False))

        # Expand colspan → multiple plain <td> cells
        for row in direct_rows:
            cells = list(row.find_all(["td", "th"], recursive=False))
            expanded: list = []
            for cell in cells:
                colspan = max(1, int(cell.get("colspan", 1) or 1))
                cell.attrs.pop("colspan", None)
                cell.attrs.pop("rowspan", None)
                cell.extract()          # detach from tree (keeps element intact)
                expanded.append(cell)
                for _ in range(colspan - 1):
                    expanded.append(soup.new_tag("td"))
            for cell in expanded:
                row.append(cell)

        # Equalise row widths
        if direct_rows:
            max_cols = max(
                len(row.find_all(["td", "th"], recursive=False))
                for row in direct_rows
            )
            for row in direct_rows:
                n = len(row.find_all(["td", "th"], recursive=False))
                for _ in range(max_cols - n):
                    row.append(soup.new_tag("td"))

    return str(soup)


async def _html_to_docx_via_gotenberg(full_html: str, gotenberg_url: str) -> bytes:
    """Convert HTML to DOCX using Gotenberg's LibreOffice endpoint.

    LibreOffice renders HTML with proper font/layout fidelity — far better than
    htmldocx which creates a plain DOCX with no styles.  Used when Gotenberg is
    configured; htmldocx is the fallback for local/no-Gotenberg setups.
    """
    import httpx

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{gotenberg_url}/forms/libreoffice/convert",
            files={"files": ("document.html", full_html.encode("utf-8"), "text/html")},
            data={"outputFormat": "docx"},
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"HTML→DOCX conversion failed (Gotenberg): {resp.status_code}")
    return resp.content


def _html_to_docx_bytes(body_html: str) -> bytes:
    from docx import Document as DocxDocument
    from htmldocx import HtmlToDocx

    doc = DocxDocument()
    HtmlToDocx().add_html_to_document(_normalize_html_tables(body_html), doc)
    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ── AI đề xuất chỉnh sửa: block-based (LLM chỉ chạm TEXT, code sở hữu thẻ) ─────

# Thẻ "block chứa text" (leaf) được gán id để LLM thao tác.
_BLOCK_TAGS = ("p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th")

# Allowlist thẻ + thuộc tính cho bleach (Tuyến 2 — sanitize).
_ALLOWED_TAGS = [
    "p", "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "b", "em", "i", "u", "br", "span",
    "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th",
]
_ALLOWED_ATTRS = {"*": ["class"], "td": ["colspan", "rowspan"], "th": ["colspan", "rowspan"]}


def _html_blocks(html_body: str):
    """Parse HTML → (soup, [(block_id, element)], {block_id: text}).

    Gán id tuần tự `b0, b1, …` cho mỗi block chứa-text theo thứ tự tài liệu.
    Bỏ qua block lồng nhau rỗng; `td/th` chỉ tính nếu có text trực tiếp.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html_body or "", "html.parser")
    blocks: list[tuple[str, object]] = []
    text_map: dict[str, str] = {}
    idx = 0
    for el in soup.find_all(_BLOCK_TAGS):
        # Bỏ block bao ngoài chỉ chứa block con khác (vd <td><p>…</p></td>):
        # ưu tiên gán cho block lá để replace không xoá cấu trúc con.
        if el.find(_BLOCK_TAGS) is not None:
            continue
        text = el.get_text(" ", strip=True)
        if not text:
            continue
        bid = f"b{idx}"
        el["data-bid"] = bid
        blocks.append((bid, el))
        text_map[bid] = text
        idx += 1
    return soup, blocks, text_map


def _tokens_in(text: str) -> set[str]:
    import re as _re
    return set(_re.findall(r"\{[a-zA-Z0-9_]+\}", text or ""))


def _apply_block_ops(html_body: str, ops: list["BlockEditOp"]) -> tuple[str, list[str]]:
    """Áp dụng danh sách op lên HTML, GIỮ NGUYÊN thẻ. Trả (html_mới, warnings).

    Tuyến 1: code sinh mọi thẻ (replace set text; insert tạo thẻ theo kind).
    """
    soup, blocks, _ = _html_blocks(html_body)
    by_id = {bid: el for bid, el in blocks}
    warnings: list[str] = []

    for op in ops:
        el = by_id.get(op.block_id)
        if el is None:
            warnings.append(f"Bỏ qua thao tác '{op.op}': không tìm thấy block {op.block_id}.")
            continue
        if op.op == "replace":
            new_text = (op.new_text or "").strip()
            if not new_text:
                warnings.append(f"Bỏ qua replace {op.block_id}: nội dung mới rỗng.")
                continue
            # Re-inject {field} tokens the LLM dropped to prevent data loss.
            # AI is only supposed to edit static text, not remove field placeholders.
            original_text = el.get_text(" ", strip=True)
            lost = _tokens_in(original_text) - _tokens_in(new_text)
            if lost:
                new_text = new_text.rstrip() + " " + " ".join(sorted(lost))
                warnings.append(f"Giữ lại trường bị mất sau chỉnh sửa AI: {', '.join(sorted(lost))}")
            el.clear()
            el.append(new_text)
        elif op.op == "delete":
            el.decompose()
            by_id.pop(op.block_id, None)
        elif op.op == "insert_after":
            text = (op.text or "").strip()
            if not text:
                warnings.append(f"Bỏ qua insert sau {op.block_id}: nội dung rỗng.")
                continue
            parent_name = getattr(el.parent, "name", None)
            if op.kind == "list_item" and parent_name in ("ul", "ol"):
                tag_name = "li"
            elif op.kind == "heading":
                tag_name = "h2"
            else:
                tag_name = "p"
            new_el = soup.new_tag(tag_name)
            new_el.append(text)
            el.insert_after(new_el)

    # Gỡ thuộc tính đánh dấu nội bộ trước khi trả.
    for el in soup.find_all(attrs={"data-bid": True}):
        del el["data-bid"]
    return str(soup), warnings


def _sanitize_html(html_body: str) -> str:
    """Tuyến 2: strip mọi thẻ/thuộc tính ngoài allowlist (loại script/style/…)."""
    import bleach

    return bleach.clean(
        html_body or "",
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRS,
        strip=True,
    )


def _build_diff_html(source_html: str, ops: list["BlockEditOp"]) -> str:
    """Dựng NGUYÊN tài liệu với mỗi chỗ sửa highlight tại chỗ (track-changes inline).

    Mỗi block thay đổi mang `data-op="op-{i}"` + class `dg-diff-block`; bên trong có
    span `.dg-diff-old` (gạch đỏ) / `.dg-diff-new` (xanh) + cụm nút `.dg-diff-actions`
    (span `data-act="accept|reject"`). Markup này do BACKEND kiểm soát → KHÔNG bleach.
    op_id `op-{i}` khớp đúng thứ tự ops mà FE nhận để map accept/reject.
    """
    clean = _sanitize_html(source_html)  # làm sạch nguồn trước, rồi mới chèn markup tin cậy
    soup, blocks, _ = _html_blocks(clean)
    by_id = {bid: el for bid, el in blocks}

    def _span(cls: str, text: str):
        s = soup.new_tag("span", attrs={"class": cls})
        s.append(text or "")
        return s

    def _actions(op_id: str):
        wrap = soup.new_tag("span", attrs={"class": "dg-diff-actions", "data-op": op_id})
        acc = soup.new_tag("span", attrs={"class": "dg-diff-accept", "data-op": op_id, "data-act": "accept"})
        acc.append("✓")
        rej = soup.new_tag("span", attrs={"class": "dg-diff-reject", "data-op": op_id, "data-act": "reject"})
        rej.append("✗")
        wrap.append(acc)
        wrap.append(rej)
        return wrap

    for i, op in enumerate(ops):
        op_id = f"op-{i}"
        el = by_id.get(op.block_id)
        if el is None:
            continue
        if op.op == "replace":
            old = el.get_text(" ", strip=True)
            el["data-op"] = op_id
            el["class"] = el.get("class", []) + ["dg-diff-block"]
            el.clear()
            el.append(_span("dg-diff-old", old))
            el.append(" ")
            el.append(_span("dg-diff-new", op.new_text or ""))
            el.append(_actions(op_id))
        elif op.op == "delete":
            old = el.get_text(" ", strip=True)
            el["data-op"] = op_id
            el["class"] = el.get("class", []) + ["dg-diff-block"]
            el.clear()
            el.append(_span("dg-diff-old", old))
            el.append(_actions(op_id))
        elif op.op == "insert_after":
            parent_name = getattr(el.parent, "name", None)
            if op.kind == "list_item" and parent_name in ("ul", "ol"):
                tag_name = "li"
            elif op.kind == "heading":
                tag_name = "h2"
            else:
                tag_name = "p"
            new_el = soup.new_tag(tag_name, attrs={"class": "dg-diff-block dg-diff-ins", "data-op": op_id})
            new_el.append(_span("dg-diff-new", op.text or ""))
            new_el.append(_actions(op_id))
            el.insert_after(new_el)

    for el in soup.find_all(attrs={"data-bid": True}):
        del el["data-bid"]
    return str(soup)


def _structural_guard(before_html: str, after_html: str) -> list[str]:
    """Tuyến 2: cảnh báo nếu bảng biến mất hoàn toàn sau khi sửa."""
    from bs4 import BeautifulSoup

    warnings: list[str] = []
    b = BeautifulSoup(before_html or "", "html.parser")
    a = BeautifulSoup(after_html or "", "html.parser")
    before_tables = len(b.find_all("table"))
    after_tables = len(a.find_all("table"))
    if before_tables > 0 and after_tables < before_tables:
        warnings.append(
            f"Cảnh báo: số bảng giảm từ {before_tables} xuống {after_tables} sau khi chỉnh sửa."
        )
    return warnings
