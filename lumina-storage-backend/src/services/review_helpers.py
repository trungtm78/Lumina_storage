"""Phase 8 (slice B1a) — helper trích xuất văn bản/outline/numbering/revisions cho review.

Tách VERBATIM khỏi route `api/v1/routes/review.py` (god-module). PURE/non-DB: thao tác
trên bytes/str (DOCX/PDF/.doc) + regex, KHÔNG chạm session/repository. _extract_doc_via_gotenberg
gọi HTTP Gotenberg (lazy httpx); _convert_doc_to_docx gọi LibreOffice (subprocess). KHÔNG khởi
tạo Pydantic model review (nên không cần schemas).
"""
from __future__ import annotations

import logging
import re
import zipfile
from io import BytesIO

from src.core.config import get_settings

_log = logging.getLogger(__name__)

_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


# ─── Step 1: Document text extraction ────────────────────────────────────────
#
# Mục tiêu: text LLM nhận vào phải GIỐNG HỆT text FE render trong DOM.
# mammoth.js (DOCX viewer FE) tạo ra plain text từ DOCX — không có **, *, #, |.
# Những ký tự markdown này là artifact từ MarkItDown/fitz; nếu còn sót lại,
# LLM sẽ copy vào modified_text và FE không thể locate được trên DOM.
#
# Priority per format:
#   .doc  → Gotenberg (LibreOffice→PDF→fitz markdown) → MarkItDown fallback
#   .docx → mammoth.extract_raw_text (SAME engine as FE) → python-docx → MarkItDown
#   .pdf  → fitz markdown → MarkItDown (pdfminer) fallback
#   other → MarkItDown


def _strip_inline_md(text: str) -> str:
    """Xóa tất cả markdown formatting → plain text khớp với mammoth.js textContent.

    Các bước theo thứ tự quan trọng:
    0. Unescape backslash escapes (MarkItDown artifact)
    1. Code blocks
    2. Links / Images
    3. Bold **...** với DOTALL (đoạn dài, multi-line) + context-aware space
    4. Italic *...* context-aware
    5. __bold__ và _italic_ (word-boundary guard)
    6. ~~Strikethrough~~
    7. Headings / List prefixes
    8. Tables → mỗi cell thành 1 dòng (mammoth DOM không có separator)
    9. Normalize whitespace
    """
    # ── 0. Unescape markdown backslash escapes (MarkItDown artifact) ──────────
    # MarkItDown escapes special chars: \[ → [, \( → (, \- → -, etc.
    text = re.sub(r'\\([\\`*_{}\[\]()#+!\-.‐|~])', r'\1', text)

    # ── 1. Code blocks ────────────────────────────────────────────────────────
    text = re.sub(r'```[\s\S]*?```', '', text)
    text = re.sub(r'`([^`\n]{1,500})`', r'\1', text)

    # ── 2. Links / Images ─────────────────────────────────────────────────────
    text = re.sub(r'!\[([^\]\n]*)\]\([^)\n]*\)', r'\1', text)
    text = re.sub(r'\[([^\]\n]+)\]\([^)\n]+\)', r'\1', text)

    # ── 3. Bold **...** — DOTALL để khớp đoạn dài và multi-line ──────────────
    # Context-aware: tránh "Công**ty**" → "Côngty" (thiếu space)
    def _replace_bold(m: re.Match) -> str:
        s = m.string
        before = s[m.start() - 1] if m.start() > 0 else ''
        after  = s[m.end()]       if m.end() < len(s) else ''
        sp_b = ' ' if before.isalnum() else ''
        sp_a = ' ' if after.isalnum()  else ''
        return f'{sp_b}{m.group(1)}{sp_a}'

    text = re.sub(r'\*\*([\s\S]+?)\*\*', _replace_bold, text)
    # Xóa ** còn sót (unpaired hoặc ở giữa 2 word-char)
    text = re.sub(r'(?<=\w)\*\*(?=\w)', ' ', text)
    text = text.replace('**', '')

    # ── 4. Italic *...* — single-line, context-aware ──────────────────────────
    def _replace_italic(m: re.Match) -> str:
        s = m.string
        before = s[m.start() - 1] if m.start() > 0 else ''
        after  = s[m.end()]       if m.end() < len(s) else ''
        sp_b = ' ' if before.isalnum() else ''
        sp_a = ' ' if after.isalnum()  else ''
        return f'{sp_b}{m.group(1)}{sp_a}'

    text = re.sub(r'(?<!\*)\*([^*\n]{1,1000}?)\*(?!\*)', _replace_italic, text)

    # ── 5. __bold__ và _italic_ (word-boundary guard: tránh số_hợp_đồng) ─────
    text = re.sub(r'(?<!\w)__([^_\n]{1,1000}?)__(?!\w)', r'\1', text)
    text = re.sub(r'(?<!\w)_([^_\n]{1,1000}?)_(?!\w)',   r'\1', text)

    # ── 6. ~~Strikethrough~~ ──────────────────────────────────────────────────
    text = re.sub(r'~~([^~\n]{1,1000}?)~~', r'\1', text)

    # ── 7. Headings / List prefixes ở đầu dòng ───────────────────────────────
    text = re.sub(r'^#{1,6}[ \t]+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^[ \t]*[*+\-][ \t]+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^[ \t]*\d+(?:\.\d+)*\.[ \t]+', '', text, flags=re.MULTILINE)

    # ── 8. Tables: mỗi cell → 1 dòng riêng ───────────────────────────────────
    # mammoth.js không separator giữa cells: <td>A</td><td>B</td> → "AB" (concat).
    # LLM cần thấy từng cell trên 1 dòng → chỉ copy 1 cell → FE tìm thấy.
    text = re.sub(r'^[ \t]*\|[\s\-:=|]+\|?[ \t]*$', '', text, flags=re.MULTILINE)

    def _expand_table_row(m: re.Match) -> str:
        cells = [c.strip() for c in m.group(0).split('|')]
        return '\n'.join(c for c in cells if c)

    text = re.sub(r'^[ \t]*\|[^\n]*\|[ \t]*$', _expand_table_row, text, flags=re.MULTILINE)

    # ── 9. Normalize ─────────────────────────────────────────────────────────
    text = re.sub(r'[ \t]{2,}', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text


def _detect_bilingual(text: str) -> bool:
    """Phát hiện tài liệu song ngữ Việt–Anh bằng phân tích đoạn văn.

    Trả True nếu tài liệu chứa số lượng đoạn văn tiếng Việt và tiếng Anh đủ lớn (tối thiểu 3 đoạn mỗi ngôn ngữ).
    """
    paragraphs = [p.strip() for p in text.split("\n") if len(p.strip()) >= 20]
    if len(paragraphs) < 4:
        vi_markers = ["Điều ", "Khoản ", "CỘNG HÒA", "Bên A", "Bên B", "Hợp đồng"]
        en_markers = ["Article ", "Section ", "SOCIALIST REPUBLIC", "Party A", "Party B", "Agreement"]
        vi_count = sum(1 for m in vi_markers if m in text)
        en_count = sum(1 for m in en_markers if m in text)
        return vi_count >= 2 and en_count >= 2

    vi_diacritics = set("đĐàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹ")
    english_stopwords = {
        "the", "of", "and", "to", "in", "is", "that", "for", "on", "with",
        "by", "as", "at", "this", "shall", "be", "hereby", "agreement",
        "party", "parties", "contract", "under", "have", "has", "are"
    }

    n_vi = 0
    n_en = 0

    for p in paragraphs:
        has_vi = any(c in vi_diacritics for c in p)
        if has_vi:
            n_vi += 1
            continue

        words = set(p.lower().split())
        has_en = bool(words & english_stopwords)
        if has_en:
            n_en += 1

    return n_vi >= 3 and n_en >= 3


def _extract_doc_via_gotenberg(content: bytes) -> str | None:
    """Convert binary .doc → PDF via Gotenberg, then extract text with fitz.

    Ưu tiên dùng markdown mode (PyMuPDF ≥ 1.24) để giữ cấu trúc bảng;
    fallback về plain text nếu không hỗ trợ. Trả None khi Gotenberg chưa cấu hình
    hoặc khi conversion thất bại (caller sẽ fallback về MarkItDown).
    """
    gotenberg_url = get_settings().gotenberg_url
    if not gotenberg_url:
        return None
    try:
        import httpx
        import fitz  # type: ignore

        resp = httpx.post(
            f"{gotenberg_url}/forms/libreoffice/convert",
            files={"files": ("document.doc", content, "application/msword")},
            timeout=130,
        )
        if resp.status_code != 200:
            return None
        pdf = fitz.open(stream=resp.content, filetype="pdf")
        pages: list[str] = []
        for page in pdf:
            try:
                t = page.get_text("markdown").strip()
            except Exception:
                t = page.get_text("text").strip()
            if t:
                pages.append(t)
        pdf.close()
        text = "\n\n".join(pages)
        return _strip_inline_md(text) if text else None
    except Exception as exc:
        _log.warning("_extract_doc_via_gotenberg failed: %s", exc)
        return None


def _convert_doc_to_docx(doc_bytes: bytes) -> bytes | None:
    """Convert binary .doc → .docx using LibreOffice (soffice --headless).

    Dùng cho Path A (tracked changes DOCX): cần python-docx mở được file.
    Trả None nếu LibreOffice không có hoặc conversion thất bại.
    """
    import subprocess
    import tempfile
    import os

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            doc_path = os.path.join(tmpdir, "input.doc")
            with open(doc_path, "wb") as fh:
                fh.write(doc_bytes)
            proc = subprocess.run(
                ["soffice", "--headless", "--convert-to", "docx", "--outdir", tmpdir, doc_path],
                capture_output=True,
                timeout=90,
            )
            if proc.returncode != 0:
                _log.debug("soffice convert failed (rc=%d): %s", proc.returncode, proc.stderr[:200])
                return None
            out_path = os.path.join(tmpdir, "input.docx")
            if not os.path.exists(out_path):
                return None
            with open(out_path, "rb") as fh:
                return fh.read()
    except FileNotFoundError:
        _log.debug("LibreOffice (soffice) not found — .doc Path A unavailable")
    except Exception as exc:
        _log.debug("_convert_doc_to_docx failed: %s", exc)
    return None


def _extract_text(content: bytes, filename: str) -> str:
    """Extract plain document text khớp DOM FE để LLM anchor verbatim.

    Thứ tự ưu tiên:
      .doc  → Gotenberg (LibreOffice→PDF→fitz) → MarkItDown fallback
      .docx → mammoth.extract_raw_text (cùng engine FE) → python-docx walk → MarkItDown
      .pdf  → fitz markdown → MarkItDown (pdfminer) fallback
      other → MarkItDown

    Lý do ưu tiên mammoth cho DOCX: mammoth.js FE và mammoth Python library dùng
    CÙNG thuật toán extract — output giống hệt DOM textContent.
    LLM copy modified_text từ text này → FE locate bằng exact string match → luôn tìm được.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    # ── 1. Binary .doc → Gotenberg → PDF → fitz ───────────────────────────────
    if ext == "doc":
        text = _extract_doc_via_gotenberg(content)
        if text:
            return text
        # Gotenberg unavailable — fall through to MarkItDown below

    # ── 2. DOCX (và .doc fallback khi Gotenberg không có) ────────────────────
    if ext in ("docx", "doc"):
        # Priority 1: mammoth.extract_raw_text — identical engine với FE mammoth.js
        try:
            import mammoth  # type: ignore
            _result = mammoth.extract_raw_text(BytesIO(content))
            _text = (_result.value or "").strip()
            if _text:
                return _text  # already plain text — NO _strip_inline_md needed
        except Exception:
            pass

        # Priority 2: MarkItDown (markdown output cần strip)
        try:
            from markitdown import MarkItDown  # type: ignore
            _md = MarkItDown()
            _res = _md.convert_stream(BytesIO(content), file_extension=f".{ext}")
            _text = (_res.text_content or "").strip()
            if _text:
                return _strip_inline_md(_text)
        except Exception:
            pass

        # Priority 3: python-docx structural walk (khi cả hai trên đều fail)
        try:
            from docx import Document as DocxDocument  # type: ignore
            from docx.oxml.ns import qn as _qn

            _docx = DocxDocument(BytesIO(content))
            _parts: list[str] = []
            _W_P = _qn("w:p"); _W_TBL = _qn("w:tbl"); _W_TR = _qn("w:tr")
            _W_TC = _qn("w:tc"); _W_T = _qn("w:t")

            def _cell_text(tc_el) -> str:
                paras = []
                for para in tc_el.iter(_W_P):
                    p = "".join(t.text or "" for t in para.iter(_W_T)).strip()
                    if p:
                        paras.append(p)
                return " / ".join(paras)

            def _walk_body(el) -> None:
                for child in el:
                    tag = child.tag
                    if tag == _W_P:
                        t = "".join(x.text or "" for x in child.iter(_W_T)).strip()
                        if t:
                            _parts.append(t)
                    elif tag == _W_TBL:
                        for tr in child.iter(_W_TR):
                            seen: set[str] = set()
                            for tc in tr.findall(_W_TC):
                                ct = _cell_text(tc)
                                if ct and ct not in seen:
                                    seen.add(ct)
                                    _parts.append(ct)

            _walk_body(_docx.element.body)
            for section in _docx.sections:
                for hdr_ftr in (section.header, section.footer):
                    try:
                        if hdr_ftr and not hdr_ftr.is_linked_to_previous:
                            for para in hdr_ftr.paragraphs:
                                if para.text.strip():
                                    _parts.append(para.text.strip())
                    except Exception:
                        pass
            _text = "\n".join(_parts)
            if _text.strip():
                return _text
        except Exception:
            pass

        return f"[Không thể đọc nội dung file {filename}. File có thể bị lỗi hoặc định dạng không được hỗ trợ.]"

    # ── 3. PDF: fitz markdown (giữ cấu trúc bảng) ────────────────────────────
    if ext == "pdf":
        try:
            import fitz  # type: ignore
            _pdf = fitz.open(stream=content, filetype="pdf")
            _pages: list[str] = []
            for _page in _pdf:
                try:
                    _t = _page.get_text("markdown").strip()
                except Exception:
                    _t = _page.get_text("text").strip()
                if _t:
                    _pages.append(_t)
            _pdf.close()
            _text = "\n\n".join(_pages)
            if _text.strip():
                return _strip_inline_md(_text)
        except Exception:
            pass
        # PDF fallback → MarkItDown (pdfminer) below

    # ── 4. Tất cả định dạng còn lại (xlsx, pptx, txt, csv…): MarkItDown ──────
    try:
        from markitdown import MarkItDown  # type: ignore
        _md = MarkItDown()
        _res = _md.convert_stream(BytesIO(content), file_extension=f".{ext}")
        _raw = _res.text_content or f"[Không thể đọc nội dung file {filename}]"
        return _strip_inline_md(_raw)
    except Exception:
        return f"[Không thể đọc nội dung file {filename}. File có thể bị lỗi hoặc định dạng không được hỗ trợ.]"


# ─── Step 2: DOCX numbering reconstruction ───────────────────────────────────
#
# mammoth và python-docx extract paragraph text KHÔNG có số thứ tự tự động
# của Word (1., 1.1., a), Điều N…) — những số này nằm trong word/numbering.xml
# dưới dạng w:numPr. FE preview (mammoth.js) cũng bỏ chúng đi.
#
# Ta reconstruct số thứ tự thực để:
#   1. Hiển thị trong preview FE (inject vào rendered HTML)
#   2. LLM có thể cite đúng số điều khoản trong clause_name
#
# QUAN TRỌNG: doc_text (dùng cho verbatim match) KHÔNG bị thay đổi.
# Outline chỉ là "reference-only" — LLM đọc để biết số thứ tự, nhưng
# modified_text/anchor_text vẫn phải copy verbatim từ doc_text (không có số).


def _num_to_letter(n: int, *, lower: bool = True) -> str:
    """1→a, 26→z, 27→aa (spreadsheet-style)."""
    if n <= 0:
        return ""
    s = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        s = chr(97 + rem) + s
    return s if lower else s.upper()


def _num_to_roman(n: int) -> str:
    if n <= 0 or n >= 4000:
        return str(n)
    vals = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"),
            (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"),
            (5, "v"), (4, "iv"), (1, "i")]
    out = ""
    for v, sym in vals:
        while n >= v:
            out += sym
            n -= v
    return out


def _fmt_num(n: int, num_fmt: str) -> str:
    if num_fmt in ("decimal", "", None):
        return str(n)
    if num_fmt == "decimalZero":
        return f"{n:02d}"
    if num_fmt == "lowerLetter":
        return _num_to_letter(n, lower=True)
    if num_fmt == "upperLetter":
        return _num_to_letter(n, lower=False)
    if num_fmt == "lowerRoman":
        return _num_to_roman(n)
    if num_fmt == "upperRoman":
        return _num_to_roman(n).upper()
    return str(n)


def _extract_docx_numbered_items(
    content: bytes, filename: str, *, max_items: int = 600
) -> list[tuple[str, str]]:
    """Reconstruct (label, full_text) cho mỗi auto-numbered paragraph trong DOCX.

    Trả [] nếu file không phải docx/doc, không có numbering, hoặc parse fail
    (graceful degradation — caller xuống cấp về "no numbering").

    Thuật toán:
    1. Parse numbering.xml → abstract[abs_id][ilvl] = {fmt, lvlText, start}
    2. Build style_numpr để xử lý numbering gắn vào paragraph style
    3. Walk paragraph + table elements, resolve numPr, build label từ lvlText (%1..%9)
    4. Reset deeper levels khi level cha tăng
    5. Bilingual table: mirror col 0 labels sang các cột còn lại
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("docx", "doc"):
        return []
    try:
        from docx import Document as DocxDocument  # type: ignore
        from docx.oxml.ns import qn as _qn

        docx = DocxDocument(BytesIO(content))

        # 1. Parse numbering.xml
        abstract: dict[str, dict[int, dict]] = {}
        num_map: dict[str, str] = {}
        try:
            numbering_el = docx.part.numbering_part.element
        except Exception:
            return []

        for anum in numbering_el.findall(_qn("w:abstractNum")):
            abs_id = anum.get(_qn("w:abstractNumId"))
            if abs_id is None:
                continue
            levels: dict[int, dict] = {}
            for lvl in anum.findall(_qn("w:lvl")):
                try:
                    ilvl = int(lvl.get(_qn("w:ilvl")) or 0)
                except (TypeError, ValueError):
                    continue
                fmt_el = lvl.find(_qn("w:numFmt"))
                text_el = lvl.find(_qn("w:lvlText"))
                start_el = lvl.find(_qn("w:start"))
                levels[ilvl] = {
                    "fmt": (fmt_el.get(_qn("w:val")) if fmt_el is not None else "decimal"),
                    "lvlText": (text_el.get(_qn("w:val")) if text_el is not None else "%1."),
                    "start": int(start_el.get(_qn("w:val")) or 1) if start_el is not None else 1,
                }
            abstract[abs_id] = levels

        # num_overrides[num_id][ilvl] = start value forced by w:lvlOverride/w:startOverride
        num_overrides: dict[str, dict[int, int]] = {}
        for num in numbering_el.findall(_qn("w:num")):
            num_id = num.get(_qn("w:numId"))
            abs_ref = num.find(_qn("w:abstractNumId"))
            if num_id is not None and abs_ref is not None:
                num_map[num_id] = abs_ref.get(_qn("w:val"))
            for ov in num.findall(_qn("w:lvlOverride")):
                try:
                    ov_ilvl = int(ov.get(_qn("w:ilvl")) or 0)
                except (TypeError, ValueError):
                    continue
                so = ov.find(_qn("w:startOverride"))
                if so is not None and so.get(_qn("w:val")):
                    try:
                        num_overrides.setdefault(num_id, {})[ov_ilvl] = int(so.get(_qn("w:val")))
                    except (TypeError, ValueError):
                        pass

        if not abstract or not num_map:
            return []

        # 1b. Style-level numbering — nhiều file gắn list vào paragraph STYLE
        #     thay vì direct w:numPr. Build styleId → (numId, ilvl), following basedOn.
        style_numpr: dict[str, tuple[str, int]] = {}
        style_basedon: dict[str, str] = {}
        try:
            styles_el = docx.styles.element
            for st in styles_el.findall(_qn("w:style")):
                sid = st.get(_qn("w:styleId"))
                if sid is None:
                    continue
                bo = st.find(_qn("w:basedOn"))
                if bo is not None and bo.get(_qn("w:val")):
                    style_basedon[sid] = bo.get(_qn("w:val"))
                snp = st.find(f"{_qn('w:pPr')}/{_qn('w:numPr')}")
                if snp is not None:
                    nid = snp.find(_qn("w:numId"))
                    ilv = snp.find(_qn("w:ilvl"))
                    if nid is not None and nid.get(_qn("w:val")):
                        try:
                            sil = int(ilv.get(_qn("w:val"))) if ilv is not None else 0
                        except (TypeError, ValueError):
                            sil = 0
                        style_numpr[sid] = (nid.get(_qn("w:val")), sil)
        except Exception:
            pass

        def _style_num(style_id: str | None) -> tuple[str, int] | None:
            seen: set[str] = set()
            cur = style_id
            while cur and cur not in seen:
                seen.add(cur)
                if cur in style_numpr:
                    return style_numpr[cur]
                cur = style_basedon.get(cur)
            return None

        # 2. Walk paragraphs theo thứ tự, đếm per (num_id, level), build labels
        counters: dict[tuple[str, int], int] = {}
        active_num_ids: dict[tuple[int, bool], str] = {}
        parent_prefixes: dict[tuple[str, int], list[int]] = {}

        _P_TAG   = _qn("w:p")
        _TBL_TAG = _qn("w:tbl")
        _TR_TAG  = _qn("w:tr")
        _TC_TAG  = _qn("w:tc")
        _T_TAG   = _qn("w:t")

        items: list[tuple[str, str]] = []

        def _get_parent_prefix(li: int, current_num_id: str) -> list[int]:
            prefix = []
            for pi in range(0, li):
                lc = None
                if current_num_id:
                    lc = counters.get((current_num_id, pi))
                if lc is None:
                    lc = _get_active_counter(pi, current_num_id, enforce_compatibility=False)
                if lc is None:
                    curr_abs_id = num_map.get(current_num_id)
                    if curr_abs_id and curr_abs_id in abstract:
                        lc = num_overrides.get(current_num_id, {}).get(pi, abstract[curr_abs_id].get(pi, {}).get("start", 1))
                    else:
                        lc = 1
                prefix.append(lc or 1)
            return prefix

        def _get_active_counter(li: int, current_num_id: str, enforce_compatibility: bool = True) -> int | None:
            curr_abs_id = num_map.get(current_num_id)
            if curr_abs_id is None or curr_abs_id not in abstract:
                return None
            curr_levels = abstract[curr_abs_id]
            curr_lvl_text = curr_levels.get(li, {}).get("lvlText", "")
            curr_is_text = any(c.isalpha() for c in curr_lvl_text)
            
            if enforce_compatibility:
                key = (li, curr_is_text)
                if key in active_num_ids:
                    active_nid = active_num_ids[key]
                    if li == 0:
                        active_abs_id = num_map.get(active_nid)
                        if active_abs_id != curr_abs_id:
                            return None
                    if li > 0:
                        stored_prefix = parent_prefixes.get((active_nid, li))
                        if stored_prefix is not None:
                            current_prefix = _get_parent_prefix(li, current_num_id)
                            if stored_prefix != current_prefix:
                                return None
                    return counters.get((active_nid, li))
                return None
            else:
                prefer_text = (li == 0)
                key1 = (li, prefer_text)
                key2 = (li, not prefer_text)
                for key in (key1, key2):
                    if key in active_num_ids:
                        active_nid = active_num_ids[key]
                        if li > 0:
                            stored_prefix = parent_prefixes.get((active_nid, li))
                            if stored_prefix is not None:
                                current_prefix = _get_parent_prefix(li, current_num_id)
                                if stored_prefix != current_prefix:
                                    continue
                        val = counters.get((active_nid, li))
                        if val is not None:
                            return val
                return None

        def _resolve_numpr(p_el) -> tuple[str, int] | None:
            numpr = p_el.find(f"{_qn('w:pPr')}/{_qn('w:numPr')}")
            num_id = None
            direct_ilvl: int | None = None
            if numpr is not None:
                numid_el = numpr.find(_qn("w:numId"))
                ilvl_el = numpr.find(_qn("w:ilvl"))
                if numid_el is not None:
                    num_id = numid_el.get(_qn("w:val"))
                if ilvl_el is not None:
                    try:
                        direct_ilvl = int(ilvl_el.get(_qn("w:val")))
                    except (TypeError, ValueError):
                        direct_ilvl = None
            style_ilvl = 0
            if num_id is None:
                pstyle_el = p_el.find(f"{_qn('w:pPr')}/{_qn('w:pStyle')}")
                style_id = pstyle_el.get(_qn("w:val")) if pstyle_el is not None else None
                resolved = _style_num(style_id)
                if resolved is None:
                    return None
                num_id, style_ilvl = resolved
            if num_id is None or num_id == "0":
                return None
            ilvl = direct_ilvl if direct_ilvl is not None else style_ilvl
            return num_id, ilvl

        _PSTYLE_TAG = f"{_qn('w:pPr')}/{_qn('w:pStyle')}"

        def _process_para(p_el) -> None:
            text = "".join(t.text or "" for t in p_el.iter(_T_TAG)).strip()
            if not text:
                return

            # Heading styles → H1/H2/H3 labels
            pstyle_el = p_el.find(_PSTYLE_TAG)
            style_id = pstyle_el.get(_qn("w:val")) if pstyle_el is not None else None
            if style_id:
                hm = re.match(r'(?i)heading\s*(\d+)', style_id.replace("-", " "))
                if hm:
                    items.append((f"H{hm.group(1)}", " ".join(text.split())))
                    return

            resolved = _resolve_numpr(p_el)
            if resolved is None:
                return
            num_id, ilvl = resolved
            abs_id = num_map.get(num_id)
            if abs_id is None or abs_id not in abstract:
                return
            levels = abstract[abs_id]
            if ilvl not in levels:
                return
            if levels[ilvl].get("fmt") in ("bullet", "none"):
                # Emit bullet with actual lvlText char if printable, else "•"
                raw_bullet = (levels[ilvl].get("lvlText") or "").strip()
                bullet_label = raw_bullet if raw_bullet and not re.search(r"%\d", raw_bullet) else "•"
                items.append((bullet_label, " ".join(text.split())))
                return
            
            key = (num_id, ilvl)
            start_val = num_overrides.get(num_id, {}).get(ilvl, levels[ilvl]["start"])
            
            if key in counters:
                counters[key] += 1
            else:
                active_lc = _get_active_counter(ilvl, num_id, enforce_compatibility=True)
                base_val = active_lc if active_lc is not None else (start_val - 1)
                counters[key] = base_val + 1
                
            curr_lvl_text = levels.get(ilvl, {}).get("lvlText", "")
            curr_is_text = any(c.isalpha() for c in curr_lvl_text)
            active_num_ids[(ilvl, curr_is_text)] = num_id
            
            if ilvl > 0:
                parent_prefixes[key] = _get_parent_prefix(ilvl, num_id)
                
            for k in list(counters):
                if k[1] > ilvl:
                    k_abs = num_map.get(k[0])
                    if k_abs == abs_id:
                        del counters[k]
                        if k in parent_prefixes:
                            del parent_prefixes[k]
            for l in list(active_num_ids):
                if l[0] > ilvl:
                    active_nid = active_num_ids[l]
                    active_abs_id = num_map.get(active_nid)
                    if active_abs_id == abs_id:
                        del active_num_ids[l]
                        
            label = levels[ilvl]["lvlText"] or ""
            # Dynamically find all %N tokens in the template — never hardcode depth limit
            for m in re.finditer(r"%(\d+)", label):
                li = int(m.group(1)) - 1   # token %1 → level index 0
                token = m.group(0)
                anc_start = num_overrides.get(num_id, {}).get(li, levels.get(li, {}).get("start", 1))
                
                lc = counters.get((num_id, li))
                if lc is None:
                    lc = _get_active_counter(li, num_id, enforce_compatibility=False)
                if lc is None:
                    lc = anc_start
                    
                lfmt = levels.get(li, {}).get("fmt", "decimal")
                label = label.replace(token, _fmt_num(lc, lfmt))
            label = label.strip()
            if not label:
                return
            items.append((label, " ".join(text.split())))

        def _process_elem(elem) -> None:
            for child in elem:
                if child.tag == _P_TAG:
                    _process_para(child)
                    if len(items) >= max_items:
                        return
                elif child.tag == _TBL_TAG:
                    _process_table(child)
                    if len(items) >= max_items:
                        return

        def _process_table(tbl) -> None:
            for tr in tbl:
                if tr.tag != _TR_TAG:
                    continue
                cells = [tc for tc in tr if tc.tag == _TC_TAG]
                if not cells:
                    continue
                    
                pre_row = dict(counters)
                pre_active = dict(active_num_ids)
                pre_prefixes = dict(parent_prefixes)
                row_items_start = len(items)
                
                # Xử lý Cột 0
                _process_elem(cells[0])
                post_first = dict(counters)
                post_active = dict(active_num_ids)
                post_prefixes = dict(parent_prefixes)
                col0_labels = [label for label, _ in items[row_items_start:]]
                
                # Các cột còn lại: bắt đầu từ trạng thái pre_row
                for i, tc in enumerate(cells[1:], 1):
                    col_items_start = len(items)
                    counters.clear()
                    counters.update(pre_row)
                    active_num_ids.clear()
                    active_num_ids.update(pre_active)
                    parent_prefixes.clear()
                    parent_prefixes.update(pre_prefixes)
                    
                    _process_elem(tc)
                    
                    for j in range(len(items) - col_items_start):
                        if j < len(col0_labels):
                            items[col_items_start + j] = (
                                col0_labels[j],
                                items[col_items_start + j][1],
                            )
                counters.clear()
                counters.update(post_first)
                active_num_ids.clear()
                active_num_ids.update(post_active)
                parent_prefixes.clear()
                parent_prefixes.update(post_prefixes)

        _process_elem(docx.element.body)
        return items
    except Exception:
        return []


def _html_to_structured_items(html: str) -> list[tuple[str, str]]:
    """Parse mammoth HTML → (label, text) pairs for headings and list items.

    Labels:
    - Headings h1-h6  → "H1", "H2", …
    - Numbered list   → "1.", "1.1.", "2.3.1.", …  (hierarchical decimal)
    - Bullet list     → "•"

    Nested ol inside ol extends the prefix chain: (1,) → (1, 2) → "1.2."
    Nested ul always yields "•" regardless of parent context.
    """
    from bs4 import BeautifulSoup, NavigableString, Tag

    soup = BeautifulSoup(html, "html.parser")
    items: list[tuple[str, str]] = []

    def _direct_text(li_node: Tag) -> str:
        """Text directly in <li>, excluding nested <ol>/<ul> children."""
        parts: list[str] = []
        for child in li_node.children:
            if isinstance(child, NavigableString):
                parts.append(str(child))
            elif isinstance(child, Tag) and child.name not in ("ol", "ul"):
                parts.append(child.get_text())
        return " ".join("".join(parts).split()).strip()

    def walk(node: Tag, num_prefix: tuple[int, ...] = ()) -> None:
        if not isinstance(node, Tag):
            return
        name = node.name

        if name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            text = node.get_text().strip()
            if text:
                items.append((f"H{name[1]}", text))

        elif name == "ol":
            counter = [0]
            for child in node.children:
                if isinstance(child, Tag) and child.name == "li":
                    counter[0] += 1
                    new_prefix = num_prefix + (counter[0],)
                    text = _direct_text(child)
                    label = ".".join(str(n) for n in new_prefix) + "."
                    if text:
                        items.append((label, text))
                    for nested in child.children:
                        if isinstance(nested, Tag) and nested.name in ("ol", "ul"):
                            walk(nested, new_prefix)

        elif name == "ul":
            for child in node.children:
                if isinstance(child, Tag) and child.name == "li":
                    text = _direct_text(child)
                    if text:
                        items.append(("•", text))
                    for nested in child.children:
                        if isinstance(nested, Tag) and nested.name in ("ol", "ul"):
                            walk(nested, num_prefix)

        else:
            for child in node.children:
                walk(child, num_prefix)

    for child in soup.children:
        walk(child)

    return items


def _extract_docx_outline(
    content: bytes, filename: str, *, max_lines: int = 400, max_chars: int = 20000
) -> str:
    """LLM prompt view: 'LABEL | <90-char snippet>' per line.

    Primary: mammoth.convert_to_html() → _html_to_structured_items() — covers
    both numbered lists and bullet lists (including nested), plus headings.

    Fallback: OOXML numbering.xml reconstruction (_extract_docx_numbered_items)
    for files where mammoth HTML parse yields nothing.

    doc_text (mammoth raw text) is NOT changed — FE anchor-match constraint holds.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("docx", "doc"):
        return ""

    # Primary: OOXML reconstruction — preserves "Điều %1.", "Khoản %1.%2." lvlText
    # so labels read "Điều 1.", "Khoản 1.2." instead of generic "1.", "1.1."
    # Now also emits bullets (•) and headings (H1/H2/H3).
    items = _extract_docx_numbered_items(content, filename, max_items=max_lines)
    if items:
        lines = [f"{label} | {text[:90]}" for label, text in items]
        return "\n".join(lines)[:max_chars]

    # Fallback: mammoth HTML parse (generic labels, no lvlText)
    try:
        import mammoth  # type: ignore
        result = mammoth.convert_to_html(BytesIO(content))
        html = result.value or ""
        if html.strip():
            html_items = _html_to_structured_items(html)
            if html_items:
                lines = [f"{label} | {text[:90]}" for label, text in html_items[:max_lines]]
                return "\n".join(lines)[:max_chars]
    except Exception:
        pass

    return ""


# ─── Step 3: Track changes extraction ────────────────────────────────────────

def _extract_track_changes(content: bytes, filename: str) -> list[dict]:
    """Extract Word track-changes revisions từ DOCX metadata.

    Trả list[{type, text, author}] — dùng trong prompt [TRACK_CHANGES] section
    để LLM biết những gì đã được chỉnh sửa (ground truth) thay vì tự đoán.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext != "docx":
        return []
    try:
        from lxml import etree  # type: ignore
    except ImportError:
        return []

    revisions: list[dict] = []
    try:
        with zipfile.ZipFile(BytesIO(content)) as zf:
            with zf.open("word/document.xml") as f:
                tree = etree.parse(f)
        root = tree.getroot()
        for ins in root.iter(f"{_W_NS}ins"):
            text = "".join(t.text or "" for t in ins.iter(f"{_W_NS}t"))
            if text.strip():
                revisions.append({"type": "ins", "text": text, "author": ins.get(f"{_W_NS}author", "")})
        for dele in root.iter(f"{_W_NS}del"):
            text = "".join(t.text or "" for t in dele.iter(f"{_W_NS}delText"))
            if text.strip():
                revisions.append({"type": "del", "text": text, "author": dele.get(f"{_W_NS}author", "")})
    except Exception:
        return []
    return revisions


def _format_revisions(revisions: list[dict]) -> str:
    lines: list[str] = []
    for rev in revisions[:200]:
        marker = "+" if rev["type"] == "ins" else "-"
        text = rev["text"].strip().replace("\n", " ")
        if len(text) > 200:
            text = text[:200] + "…"
        author = rev.get("author") or "?"
        lines.append(f"  {marker} [{author}] {text}")
    if len(revisions) > 200:
        lines.append(f"  … ({len(revisions) - 200} more revisions truncated)")
    return "\n".join(lines)
