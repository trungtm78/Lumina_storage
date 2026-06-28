"""Export helpers for Document Review:

- `build_tracked_changes_docx` — produces a .docx where the customer's document text
  is reconstructed paragraph-by-paragraph with Word tracked-changes markup (w:del/w:ins)
  so the recipient can Accept/Reject each AI suggestion directly in Microsoft Word.
  Falls back to a report-style layout when doc_text is not provided.
- `build_legal_eval_html` — produces an HTML string ready to render to PDF
  (Gotenberg) for the Legal Evaluation Report.
"""
from __future__ import annotations

import html as html_lib
import io
import logging as _logging
import re as _re
import unicodedata
from copy import deepcopy as _deepcopy
from datetime import datetime, timezone

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

# ─── Tracked-changes DOCX writer ──────────────────────────────────────────────

_log = _logging.getLogger(__name__)
_AUTHOR = "Lumina Legal AI"


class _RevisionCounter:
    """Monotonic counter for OOXML revision IDs.

    Always create a fresh instance per export call — never share one instance
    across requests in a server process (would cause ID overflow / collisions).

    advance_to(n) sets the counter so __next__ returns n+1 or higher,
    guaranteed never to collide with any existing ID already in the document.
    """
    __slots__ = ("_n",)

    def __init__(self, start: int = 10_000) -> None:
        self._n = start

    def __next__(self) -> int:
        self._n += 1
        return self._n

    def advance_to(self, minimum: int) -> None:
        """Ensure the next generated ID is strictly greater than `minimum`."""
        if minimum >= self._n:
            self._n = minimum + 1  # FIX: was `minimum` — off-by-one caused duplicate IDs


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _has_text(edit: dict, field: str) -> bool:
    return bool(" ".join((edit.get(field) or "").split()))


def _para_norm(para) -> str:
    """Extract whitespace-normalised paragraph text.

    Uses python-docx .text property for consistency with MarkItDown extraction:
    both produce run-concatenated text, so anchor matching stays stable.
    Falls back to raw XML iteration when .text raises.
    """
    try:
        return " ".join(para.text.split())
    except Exception:
        raw = "".join(el.text or "" for el in para._element.iter(qn("w:t")))
        return " ".join(raw.split())


def _make_colored_rpr(color_hex: str, base_rpr=None) -> OxmlElement:
    if base_rpr is not None:
        rpr = _deepcopy(base_rpr)
        for old_c in rpr.findall(qn("w:color")):
            rpr.remove(old_c)
    else:
        rpr = OxmlElement("w:rPr")
    c_el = OxmlElement("w:color")
    c_el.set(qn("w:val"), color_hex)
    rpr.append(c_el)
    return rpr


def _w_run(text: str, *, italic: bool = False, color: str | None = None) -> OxmlElement:
    r = OxmlElement("w:r")
    if italic or color:
        rpr = OxmlElement("w:rPr")
        if italic:
            rpr.append(OxmlElement("w:i"))
        if color:
            c = OxmlElement("w:color")
            c.set(qn("w:val"), color)
            rpr.append(c)
        r.append(rpr)
    t = OxmlElement("w:t")
    t.text = text
    t.set(qn("xml:space"), "preserve")
    r.append(t)
    return r


def _add_tracked_insertion(paragraph, text: str, *, rev_id: _RevisionCounter, author: str = _AUTHOR, base_rpr=None) -> None:
    if not text:
        return
    ins = OxmlElement("w:ins")
    ins.set(qn("w:id"), str(next(rev_id)))
    ins.set(qn("w:author"), author)
    ins.set(qn("w:date"), _now_iso())
    r = OxmlElement("w:r")
    rpr = _make_colored_rpr("375623", base_rpr)
    u_el = OxmlElement("w:u")
    u_el.set(qn("w:val"), "none")
    rpr.append(u_el)
    r.append(rpr)
    t = OxmlElement("w:t")
    t.text = text
    t.set(qn("xml:space"), "preserve")
    r.append(t)
    ins.append(r)
    paragraph._element.append(ins)


def _add_tracked_deletion(paragraph, text: str, *, rev_id: _RevisionCounter, author: str = _AUTHOR, base_rpr=None) -> None:
    if not text:
        return
    dele = OxmlElement("w:del")
    dele.set(qn("w:id"), str(next(rev_id)))
    dele.set(qn("w:author"), author)
    dele.set(qn("w:date"), _now_iso())
    r = OxmlElement("w:r")
    rpr = _make_colored_rpr("C00000", base_rpr)
    r.append(rpr)
    delt = OxmlElement("w:delText")
    delt.text = text
    delt.set(qn("xml:space"), "preserve")
    r.append(delt)
    dele.append(r)
    paragraph._element.append(dele)


def _add_highlighted_run(paragraph, text: str, *, color: str = "yellow") -> None:
    """Append a run with Word character-level background highlight (w:highlight)."""
    if not text:
        return
    r = OxmlElement("w:r")
    rpr = OxmlElement("w:rPr")
    hl = OxmlElement("w:highlight")
    hl.set(qn("w:val"), color)
    rpr.append(hl)
    r.append(rpr)
    t = OxmlElement("w:t")
    t.text = text
    t.set(qn("xml:space"), "preserve")
    r.append(t)
    paragraph._element.append(r)


def _add_word_comment(
    comments_collector: list[str], paragraph, comment_text: str, *,
    rev_id: _RevisionCounter, author: str = _AUTHOR
) -> None:
    """Collect a Word comment and inject range markers into the paragraph.

    OOXML §17.13.4 requires:
      commentRangeStart  → (content runs) → commentRangeEnd → commentReference run

    This function inserts commentRangeStart immediately after w:pPr (before any
    content runs), and appends commentRangeEnd + commentReference at the very end
    of the paragraph — which is correct only when called AFTER all content runs
    (tracked deletions, insertions, plain runs) have already been appended.

    Comments are accumulated in comments_collector as raw XML strings and
    injected into the DOCX ZIP after doc.save() — avoids python-docx
    version-specific internal APIs for the comments part.
    """
    if not comment_text:
        return
    comment_id = str(next(rev_id))
    date_str = _now_iso()

    # Escape values for XML attribute / text content
    safe_author = (
        author.replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")
    )
    safe_text = html_lib.escape(comment_text)

    comments_collector.append(
        f'<w:comment xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
        f' w:id="{comment_id}" w:author="{safe_author}"'
        f' w:date="{date_str}" w:initials="LA">'
        f"<w:p><w:r>"
        f'<w:t xml:space="preserve">{safe_text}</w:t>'
        f"</w:r></w:p>"
        f"</w:comment>"
    )

    p_el = paragraph._element

    # --- commentRangeStart: must be placed BEFORE all content runs ---
    # Per OOXML §17.13.4: immediately after w:pPr, before any w:r/w:ins/w:del.
    start = OxmlElement("w:commentRangeStart")
    start.set(qn("w:id"), comment_id)
    ppr = p_el.find(qn("w:pPr"))
    if ppr is not None:
        ppr.addnext(start)
    else:
        p_el.insert(0, start)

    # --- commentRangeEnd + commentReference: appended AFTER all content runs ---
    # These must follow the last content run in document order.
    end = OxmlElement("w:commentRangeEnd")
    end.set(qn("w:id"), comment_id)
    p_el.append(end)

    ref_run = OxmlElement("w:r")
    ref = OxmlElement("w:commentReference")
    ref.set(qn("w:id"), comment_id)
    ref_run.append(ref)
    p_el.append(ref_run)


def _inject_comments(docx_buf: io.BytesIO, comment_xmls: list[str]) -> io.BytesIO:
    """Inject / merge word/comments.xml into a saved DOCX ZIP.

    Three cases handled correctly:
    - No existing comments.xml  → write new file, add relationship + content-type.
    - Existing comments.xml     → merge body using lxml (preserves namespaces).
    - Existing comments rel     → skip adding a second relationship.
    """
    import zipfile
    from lxml import etree as _lxml

    _W_NS_URI = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    _CT_ENTRY = (
        '<Override PartName="/word/comments.xml"'
        ' ContentType="application/vnd.openxmlformats-officedocument'
        '.wordprocessingml.comments+xml"/>'
    )

    docx_buf.seek(0)
    src = zipfile.ZipFile(docx_buf, "r")
    src_names = set(src.namelist())

    rels_name = "word/_rels/document.xml.rels"
    rels_raw = src.read(rels_name) if rels_name in src_names else b""
    rels_text = rels_raw.decode("utf-8", errors="replace")

    # --- Build merged comments.xml using lxml (correct namespace handling) ---
    # Start with a fresh root element that carries the canonical W namespace.
    W = f"{{{_W_NS_URI}}}"
    root = _lxml.Element(f"{W}comments", nsmap={"w": _W_NS_URI})

    # Merge existing comments (if any) by re-parenting their child nodes.
    if "word/comments.xml" in src_names:
        try:
            existing_bytes = src.read("word/comments.xml")
            existing_root = _lxml.fromstring(existing_bytes)
            for child in existing_root:
                # Deep-copy preserves all child namespaces (w14:, r:, etc.)
                from copy import deepcopy as _dc
                root.append(_dc(child))
        except Exception:
            _log.warning("_inject_comments: could not parse existing comments.xml — discarding it")

    # Append the new comments (each is a self-contained XML string with its own w: namespace).
    for xml_str in comment_xmls:
        try:
            el = _lxml.fromstring(xml_str.encode("utf-8"))
            root.append(el)
        except Exception as exc:
            _log.warning("_inject_comments: skipping malformed comment XML: %s", exc)

    comments_bytes = _lxml.tostring(
        root,
        xml_declaration=True,
        encoding="UTF-8",
        standalone=True,
    )

    # Only add a comments relationship if none exists yet
    has_comments_rel = bool(_re.search(r'Type="[^"]*relationships/comments"', rels_text))
    rel_entry_to_add = ""
    if not has_comments_rel:
        existing_rel_ids: set[str] = set(_re.findall(r'Id="(rId[^"]+)"', rels_text))
        comments_rel_id = "rIdComments"
        _suffix = 1
        while comments_rel_id in existing_rel_ids:
            comments_rel_id = f"rIdComments{_suffix}"
            _suffix += 1
        rel_entry_to_add = (
            f'<Relationship Id="{comments_rel_id}"'
            ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"'
            ' Target="comments.xml"/>'
        )

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as dst:
        for name in src.namelist():
            if name == "word/comments.xml":
                continue  # Skip existing — merged version written below
            data = src.read(name)
            if name == rels_name and rel_entry_to_add:
                data = data.replace(
                    b"</Relationships>",
                    (rel_entry_to_add + "</Relationships>").encode(),
                )
            elif name == "[Content_Types].xml":
                if b'PartName="/word/comments.xml"' not in data:
                    data = data.replace(
                        b"</Types>",
                        (_CT_ENTRY + "</Types>").encode(),
                    )
            dst.writestr(name, data)
        dst.writestr("word/comments.xml", comments_bytes)
    src.close()
    out.seek(0)
    return out


def _iter_all_paragraphs(doc):
    """Yield every Paragraph: body, tables (nested), headers, footers, textboxes."""
    yield from doc.paragraphs

    def _table_paras(table):
        for row in table.rows:
            for cell in row.cells:
                yield from cell.paragraphs
                for nested in cell.tables:
                    yield from _table_paras(nested)

    for table in doc.tables:
        yield from _table_paras(table)

    for section in doc.sections:
        for hdr_ftr in (
            section.header,
            section.footer,
            section.first_page_header,
            section.first_page_footer,
            section.even_page_header,
            section.even_page_footer,
        ):
            try:
                if hdr_ftr is not None and hdr_ftr.is_linked_to_previous is False:
                    yield from hdr_ftr.paragraphs
            except Exception:
                pass

    _txbx_tag = qn("w:txbxContent")
    _p_tag = qn("w:p")
    try:
        from docx.text.paragraph import Paragraph as _Paragraph
        for txbx in doc.element.body.iter(_txbx_tag):
            for child_p in txbx.iter(_p_tag):
                yield _Paragraph(child_p, doc)
    except Exception:
        pass


def _get_para_base_rpr(para):
    first_run = para._element.find(qn("w:r"))
    if first_run is not None:
        rpr = first_run.find(qn("w:rPr"))
        if rpr is not None:
            return _deepcopy(rpr)
    return None


def _clear_para_runs(para) -> None:
    p_el = para._element
    for tag in (qn("w:r"), qn("w:ins"), qn("w:del"), qn("w:hyperlink")):
        for el in list(p_el.findall(tag)):
            p_el.remove(el)


def _append_plain_run(para, text: str, base_rpr=None) -> None:
    if not text:
        return
    r = OxmlElement("w:r")
    if base_rpr is not None:
        r.append(_deepcopy(base_rpr))
    t = OxmlElement("w:t")
    t.text = text
    t.set(qn("xml:space"), "preserve")
    r.append(t)
    para._element.append(r)


def _accept_edit_inplace(
    para,
    before: str,
    after: str,
    suggested: str,
    *,
    found: str = "",
    comments_collector: list[str] | None = None,
    comment_text: str = "",
    rev_id: _RevisionCounter | None = None,
    insert_after_para = None,
) -> object:
    """Write the edit as already-accepted: insert suggested text with no tracking."""
    base_rpr = _get_para_base_rpr(para)
    _clear_para_runs(para)
    _append_plain_run(para, before, base_rpr)
    suggested = suggested.replace("\r\n", "\n")
    is_append, suffix = _split_append_edit(found, suggested)
    if is_append:
        lines = suggested.split("\n")
        first_line = lines[0].strip()
        _append_plain_run(para, first_line, base_rpr)
        suffix_lines = [l.strip() for l in suffix.split("\n") if l.strip()]
        current_para = insert_after_para if insert_after_para is not None else para
        for line in suffix_lines:
            new_p_el = OxmlElement("w:p")
            ppr = para._element.find(qn("w:pPr"))
            if ppr is not None:
                new_p_el.append(_deepcopy(ppr))
            current_para._element.addnext(new_p_el)
            from docx.text.paragraph import Paragraph as DocxParagraph
            new_para = DocxParagraph(new_p_el, para._parent)
            _append_plain_run(new_para, line, base_rpr)
            current_para = new_para
    else:
        lines = [l.strip() for l in suggested.split("\n") if l.strip()]
        if not lines:
            lines = [""]
        _append_plain_run(para, lines[0], base_rpr)
        current_para = para
        for line in lines[1:]:
            new_p_el = OxmlElement("w:p")
            ppr = para._element.find(qn("w:pPr"))
            if ppr is not None:
                new_p_el.append(_deepcopy(ppr))
            current_para._element.addnext(new_p_el)
            from docx.text.paragraph import Paragraph as DocxParagraph
            new_para = DocxParagraph(new_p_el, para._parent)
            _append_plain_run(new_para, line, base_rpr)
            current_para = new_para
    _append_plain_run(current_para, after, base_rpr)
    if comment_text and comments_collector is not None and rev_id is not None:
        _add_word_comment(comments_collector, current_para, f"[AI — đã áp dụng] {comment_text}", rev_id=rev_id)
    return current_para


def _edit_paragraph_inplace(
    para,
    before: str,
    found: str,
    after: str,
    suggested: str,
    *,
    rev_id: _RevisionCounter,
    comments_collector: list[str] | None = None,
    comment_text: str = "",
    insert_after_para = None,
) -> object:
    """Replace paragraph content with tracked del+ins changes, preserving w:pPr.

    Call order matters for correct OOXML structure:
      1. _clear_para_runs       — wipe existing runs (keeps w:pPr)
      2. _add_word_comment      — inserts commentRangeStart right after w:pPr
                                  (must happen before any content runs are added)
      3. _append_plain_run      — plain text before the edit
      4. _add_tracked_deletion  — w:del
      5. _add_tracked_insertion — w:ins
      6. _append_plain_run      — plain text after the edit
      commentRangeEnd + commentReference are appended last (inside _add_word_comment
      at step 2 via p_el.append — they land after whatever runs exist at call time,
      but we immediately add more runs after that).

    Correct OOXML order inside <w:p>:
      <w:pPr/> <w:commentRangeStart/> <w:r before/> <w:del/> <w:ins/>
      <w:r after/> <w:commentRangeEnd/> <w:r commentReference/>
    """
    base_rpr = _get_para_base_rpr(para)
    _clear_para_runs(para)
    _append_plain_run(para, before, base_rpr)
    suggested = suggested.replace("\r\n", "\n")
    is_append, suffix = _split_append_edit(found, suggested)
    if is_append:
        lines = suggested.split("\n")
        first_line = lines[0].strip()
        if " ".join(first_line.split()) != " ".join(found.split()):
            _add_tracked_deletion(para, found, rev_id=rev_id, base_rpr=base_rpr)
            _add_tracked_insertion(para, first_line, rev_id=rev_id, base_rpr=base_rpr)
        else:
            _append_plain_run(para, found, base_rpr)
        suffix_lines = [l.strip() for l in suffix.split("\n") if l.strip()]
        current_para = insert_after_para if insert_after_para is not None else para
        for line in suffix_lines:
            new_p_el = OxmlElement("w:p")
            ppr = para._element.find(qn("w:pPr"))
            if ppr is not None:
                new_p_el.append(_deepcopy(ppr))
            current_para._element.addnext(new_p_el)
            from docx.text.paragraph import Paragraph as DocxParagraph
            new_para = DocxParagraph(new_p_el, para._parent)
            _add_tracked_insertion(new_para, line, rev_id=rev_id, base_rpr=base_rpr)
            current_para = new_para
    else:
        lines = [l.strip() for l in suggested.split("\n") if l.strip()]
        if not lines:
            lines = [""]
        _add_tracked_deletion(para, found, rev_id=rev_id, base_rpr=base_rpr)
        _add_tracked_insertion(para, lines[0], rev_id=rev_id, base_rpr=base_rpr)
        current_para = para
        for line in lines[1:]:
            new_p_el = OxmlElement("w:p")
            ppr = para._element.find(qn("w:pPr"))
            if ppr is not None:
                new_p_el.append(_deepcopy(ppr))
            current_para._element.addnext(new_p_el)
            from docx.text.paragraph import Paragraph as DocxParagraph
            new_para = DocxParagraph(new_p_el, para._parent)
            _add_tracked_insertion(new_para, line, rev_id=rev_id, base_rpr=base_rpr)
            current_para = new_para
    _append_plain_run(current_para, after, base_rpr)
    if comment_text and comments_collector is not None:
        _add_word_comment(comments_collector, current_para, comment_text, rev_id=rev_id)
    return current_para


def _highlight_paragraph_inplace(
    para,
    before: str,
    found: str,
    after: str,
    *,
    rev_id: _RevisionCounter,
    comments_collector: list[str] | None = None,
    comment_text: str = "",
) -> None:
    """Replace paragraph content with yellow highlight for agreed edits."""
    base_rpr = _get_para_base_rpr(para)
    _clear_para_runs(para)
    _append_plain_run(para, before, base_rpr)
    _add_highlighted_run(para, found)
    _append_plain_run(para, after, base_rpr)
    if comment_text and comments_collector is not None:
        _add_word_comment(comments_collector, para, comment_text, rev_id=rev_id)


def _make_comment_text(edit: dict, *, is_agree: bool = False) -> str:
    clause = (edit.get("clause_name") or "").strip()
    reason = (edit.get("reason") or "").strip()
    if is_agree:
        return (f"[{clause} — Lưu ý] {reason}" if clause else f"[Lưu ý] {reason}").strip()
    return (f"[{clause}] {reason}" if clause else reason).strip()


def _split_append_edit(found: str, suggested: str) -> tuple[bool, str]:
    """Detect append-only edits: suggested = original_text + new_clause_below.

    When the LLM wants to ADD a new clause it often uses the last existing clause
    as the anchor (modified_text) and returns suggested_text = anchor + '\n\n' + new_clause.
    In this case we should NOT delete the anchor — just insert the new content after it.

    Returns (True, new_suffix) when append is detected, (False, suggested) otherwise.
    """
    if not found or "\n" not in suggested:
        return False, suggested
    norm_found = " ".join(found.split())
    lines = suggested.split("\n")
    first_norm = " ".join(lines[0].split())
    if first_norm == norm_found or first_norm.startswith(norm_found):
        suffix_lines = [l for l in lines[1:] if l.strip()]
        if suffix_lines:
            return True, "\n".join(suffix_lines)
    return False, suggested


def _extract_numeric_prefix(text: str) -> str | None:
    """Extract outline numbering prefix (e.g., '3.2', '3.2.1', '12') from a paragraph's text."""
    text = _strip_list_prefixes(text)
    text = " ".join(text.split()).strip()
    
    # 1. Match multi-level numbering like "3.2", "3.2.1" optionally prefixed with keywords
    # e.g., "Điều 3.2", "Article 3.2", "Khoản 12.4.1", "3.2.1. Nội dung"
    match = _re.match(
        r"^(?:Điều|Khoản|Mục|Chương|Điểm|Article|Clause|Section|Item)?[ \t]*([\d]+(?:\.[\d]+)+)",
        text,
        _re.IGNORECASE
    )
    if match:
        return match.group(1)
        
    # 2. Match single level numbering like "3." or "Điều 3" at the start of line
    # e.g. "Điều 3. Trách nhiệm", "3. Định nghĩa"
    match_single = _re.match(
        r"^(?:Điều|Khoản|Mục|Chương|Điểm|Article|Clause|Section|Item)?[ \t]*([\d]+)(?:\.|\b)",
        text,
        _re.IGNORECASE
    )
    if match_single:
        return match_single.group(1)
        
    return None


def _para_is_in_table(para) -> bool:
    """Return True if the paragraph lives inside a table cell (w:tbl ancestor)."""
    el = para._element
    while el is not None:
        if el.tag == qn("w:tbl"):
            return True
        el = el.getparent()
    return False


def _find_clause_block_end_index_path_a(paras: list, start_idx: int, anchor_prefix: str | None) -> int:
    """Find the index of the last paragraph belonging to the clause block starting at start_idx in Path A."""
    if not anchor_prefix:
        return start_idx

    idx = start_idx
    while idx + 1 < len(paras):
        next_p = paras[idx + 1]
        # Table paragraphs are structural boundaries — never part of a numbered clause body.
        if _para_is_in_table(next_p):
            break
        next_text = _para_norm(next_p)
        if not next_text.strip():
            idx += 1
            continue

        next_prefix = _extract_numeric_prefix(next_text)
        if next_prefix is None:
            # Plain body text, list item, or alphabetical bullet point -> part of current clause
            idx += 1
        elif next_prefix == anchor_prefix or next_prefix.startswith(anchor_prefix + "."):
            # Same level (bilingual counterpart) or child level -> part of current clause
            idx += 1
        else:
            # Sibling or parent level numbering -> boundary reached
            break

    return idx


def _find_clause_block_end_index_path_b(lines: list[str], start_idx: int, anchor_prefix: str | None) -> int:
    """Find the index of the last line belonging to the clause block starting at start_idx in Path B."""
    if not anchor_prefix:
        return start_idx
        
    idx = start_idx
    while idx + 1 < len(lines):
        next_line = lines[idx + 1]
        if not next_line.strip():
            idx += 1
            continue
            
        next_prefix = _extract_numeric_prefix(next_line)
        if next_prefix is None:
            # Plain body text, list item, or alphabetical bullet point -> part of current clause
            idx += 1
        elif next_prefix == anchor_prefix or next_prefix.startswith(anchor_prefix + "."):
            # Same level (bilingual counterpart) or child level -> part of current clause
            idx += 1
        else:
            # Sibling or parent level numbering -> boundary reached
            break
            
    return idx


def _nfc(s: str) -> str:
    """NFC-normalise + collapse whitespace for robust matching against LLM-generated text.

    LLMs often return NFC-composed Vietnamese diacritics (e.g. ô = U+00F4) while
    PDF/fitz extraction may emit NFD-decomposed forms (o + combining circumflex).
    Normalising both sides to NFC before comparison prevents false negatives.
    """
    return unicodedata.normalize("NFC", " ".join(s.split()))


_LIST_PREFIX_RE = _re.compile(
    r"^[ \t]*(?:"
    r"[*+\-][ \t]+"
    r"|(?:Điều|Khoản|Mục|Chương|Điểm)[ \t]+[\dIVXLCM]+(?:\.\d+)*[.):]?[ \t]+"
    r"|\d+(?:\.\d+)*[.):][ \t]+"
    r"|[A-Za-z][.)][ \t]+"
    r")",
    _re.IGNORECASE,
)


def _strip_list_prefixes(s: str) -> str:
    """Strip MarkItDown list prefixes iteratively.

    Handles nested cases like '* 1. text' (two passes needed):
      '* 1. text' → '1. text' → 'text'
    python-docx para.text and mammoth HTML never include these prefixes,
    so LLM-generated modified_text with prefixes fails to match.
    """
    while True:
        stripped = _LIST_PREFIX_RE.sub("", s, count=1).lstrip()
        if stripped == s:
            return s
        s = stripped


def _find_edit_in_paragraph(para_norm: str, edit: dict) -> tuple[str, str, str] | None:
    """Locate edit in para_norm (already whitespace-normalized).

    Strategy 1: anchor_text (short verbatim quote) — most reliable.
    Strategy 2: modified_text prefix at progressive lengths (60 → 40 → 25 → full).

    Uses NFC Unicode normalization on both sides to handle encoding mismatches
    between fitz PDF extraction and LLM-generated modified_text.

    Returns (before, matched_slice, after) or None.
    """
    if not para_norm:
        return None
    para_nfc = _nfc(para_norm)
    para_lower = para_nfc.lower()

    def _try_find(anchor_s: str, modified_s: str) -> tuple[str, str, str] | None:
        """Inner: try anchor then modified_text prefix search."""
        # Strategy 1: anchor_text
        anc = _nfc(anchor_s)
        if len(anc) >= 8:
            idx = para_lower.find(anc.lower())
            if idx >= 0:
                mod = _nfc(modified_s)
                span_end = min(idx + max(len(anc), len(mod)), len(para_nfc))
                return para_nfc[:idx], para_nfc[idx:span_end], para_nfc[span_end:]
        # Strategy 2: modified_text prefix at progressive lengths
        mod = _nfc(modified_s)
        if len(mod) < 4:
            return None
        for key_len in [kl for kl in (60, 40, 25) if len(mod) >= kl] or [len(mod)]:
            key = mod[:key_len].lower()
            idx = para_lower.find(key)
            if idx >= 0:
                end = min(idx + len(mod), len(para_nfc))
                return para_nfc[:idx], para_nfc[idx:end], para_nfc[end:]
        return None

    anchor_raw = edit.get("anchor_text") or ""
    modified_raw = edit.get("modified_text") or ""

    # Primary attempt
    result = _try_find(anchor_raw, modified_raw)
    if result is not None:
        return result

    # Fallback: strip MarkItDown list prefixes ("* 1. text" → "text")
    # python-docx para.text and mammoth HTML never include bullet/number prefixes
    anchor_stripped = _strip_list_prefixes(anchor_raw)
    modified_stripped = _strip_list_prefixes(modified_raw)
    if anchor_stripped != anchor_raw or modified_stripped != modified_raw:
        result = _try_find(anchor_stripped, modified_stripped)
        if result is not None:
            return result

    return None


def _norm_suggested(text: str) -> str:
    """Normalize spaces within each line but keep newlines so new clauses land on a separate line."""
    lines = (text or "").strip().splitlines()
    return "\n".join(" ".join(l.split()) for l in lines if l.strip())


def build_tracked_changes_docx(
    document_name: str,
    review_type: str,
    risk_score: int,
    summary: str,
    edits: list[dict],
    doc_text: str = "",
    doc_bytes: bytes = b"",
    checklist: list[dict] | None = None,
    missing_items: list[str] | None = None,
    suggestions: list[str] | None = None,
    applied_edits: dict | None = None,
) -> bytes:
    """Produce a .docx that mirrors the user's apply decisions from the app.

    applied_edits: dict keyed by modified_text — edits the user accepted in
    the app.  These are written as plain text (already resolved, no tracking).
    Edits not in applied_edits remain as w:del + w:ins tracked changes so the
    recipient can Accept/Reject in Word.  Agree-only edits (no suggested text)
    become yellow-highlight comment balloons regardless of apply state.

    Path A (doc_bytes provided): edits original DOCX in-place, preserving fonts,
    styles, tables, headers, footers.
    Path B (doc_text only): reconstructs from plain text.
    """
    _applied = applied_edits or {}

    # Fresh counter per export call — never share state across requests.
    rev_id = _RevisionCounter()
    comments_collector: list[str] = []

    # Split into three buckets:
    #   accepted  — user already applied this in the app → write as plain text
    #   pending   — user hasn't decided → w:del + w:ins tracked change
    #   agree_edits — AI agreed, no replacement needed → highlight + comment
    candidate_edits = [
        e for e in edits
        if _has_text(e, "modified_text") and _has_text(e, "suggested_text")
    ]
    accepted_edits = [e for e in candidate_edits if e.get("modified_text", "") in _applied]
    pending_edits  = [e for e in candidate_edits if e.get("modified_text", "") not in _applied]
    # Keep backward-compat name used in loop below
    tracked_edits = pending_edits

    agree_edits = [
        e for e in edits
        if e.get("verdict") == "agree"
        and _has_text(e, "modified_text")
        and not _has_text(e, "suggested_text")
    ]

    if doc_bytes:
        try:
            doc = Document(io.BytesIO(doc_bytes))
        except Exception:
            # File không phải DOCX (PDF, PPTX, …) — fallback sang Path B
            doc_bytes = b""
    if doc_bytes:
        # ── Path A: modify original DOCX in-place ────────────────────────────

        # Advance revision counter past all existing IDs to avoid collisions.
        # advance_to(max) now correctly sets _n = max+1 so next() returns max+1.
        try:
            from lxml import etree as _lxml_etree
            doc_xml_str = _lxml_etree.tostring(doc.element, encoding="unicode")
            existing_ids = [int(m) for m in _re.findall(r'w:id="(\d+)"', doc_xml_str)]
            if existing_ids:
                rev_id.advance_to(max(existing_ids))
        except Exception:
            pass

        # Pre-build bilingual edit lists so we can couple them in the first pass
        bilingual_pending: list[dict] = []
        bilingual_accepted: list[dict] = []
        for edit in edits:
            b_modified = (edit.get("bilingual_modified_text") or "").strip()
            b_suggested = (edit.get("bilingual_suggested_text") or "").strip()
            b_anchor = (edit.get("bilingual_anchor_text") or "").strip()
            if b_modified and b_suggested:
                b_edit = {
                    "id": edit.get("id", ""),
                    "clause_name": edit.get("clause_name", ""),
                    "modified_text": b_modified,
                    "anchor_text": b_anchor,
                    "suggested_text": b_suggested,
                    "reason": edit.get("reason", ""),
                    "risk_level": edit.get("risk_level", "medium"),
                    "verdict": edit.get("verdict", "disagree"),
                }
                primary_modified = (edit.get("modified_text") or "").strip()
                if primary_modified and primary_modified in _applied:
                    bilingual_accepted.append(b_edit)
                else:
                    bilingual_pending.append(b_edit)

        def _find_bilingual_para_index(paras: list, start_idx: int, b_edit: dict, max_lookahead: int = 3) -> int | None:
            for offset in range(1, max_lookahead + 1):
                idx = start_idx + offset
                if idx >= len(paras):
                    break
                p_norm = _para_norm(paras[idx])
                if _find_edit_in_paragraph(p_norm, b_edit) is not None:
                    return idx
            return None

        pending_a  = list(pending_edits)
        accepted_a = list(accepted_edits)
        noted_agree: set[int] = set()

        all_paras = list(_iter_all_paragraphs(doc))
        idx = 0
        processed_para_indices: set[int] = set()

        while idx < len(all_paras):
            if idx in processed_para_indices:
                idx += 1
                continue
            para = all_paras[idx]
            para_norm = _para_norm(para)
            if not para_norm:
                idx += 1
                continue

            matched = False

            # 1. Applied edits — write as plain accepted text (no tracking)
            for edit in list(accepted_a):
                result = _find_edit_in_paragraph(para_norm, edit)
                if result is not None:
                    before, found, after = result
                    
                    # Look ahead for bilingual counterpart in accepted list
                    b_edit = None
                    b_idx = None
                    edit_id = edit.get("id")
                    if edit_id:
                        for be in list(bilingual_accepted):
                            if be.get("id") == edit_id:
                                b_idx = _find_bilingual_para_index(all_paras, idx, be)
                                if b_idx is not None:
                                    b_edit = be
                                break
                    
                    if b_edit is not None and b_idx is not None:
                        # Bilingual pair matched in alternating paragraphs!
                        b_para = all_paras[b_idx]
                        b_para_norm = _para_norm(b_para)
                        b_result = _find_edit_in_paragraph(b_para_norm, b_edit)
                        if b_result is not None:
                            before_b, found_b, after_b = b_result
                            
                            # Find the block boundary of b_para (the EN counterpart)
                            clause_prefix = _extract_numeric_prefix(edit.get("clause_name") or "")
                            b_block_end_idx = _find_clause_block_end_index_path_a(all_paras, b_idx, clause_prefix)
                            b_block_end_para = all_paras[b_block_end_idx]
                            
                            # 1. Apply primary edit, inserting the suffix paragraphs after the end of the EN paragraph's block
                            last_vi_para = _accept_edit_inplace(
                                para, before, after,
                                suggested=_norm_suggested(edit.get("suggested_text") or ""),
                                found=found,
                                comments_collector=comments_collector,
                                comment_text=_make_comment_text(edit),
                                rev_id=rev_id,
                                insert_after_para=b_block_end_para,
                            )
                            
                            # 2. Apply bilingual edit, inserting its suffix paragraphs after the new VI paragraph
                            _accept_edit_inplace(
                                b_para, before_b, after_b,
                                suggested=_norm_suggested(b_edit.get("suggested_text") or ""),
                                found=found_b,
                                comments_collector=comments_collector,
                                comment_text=_make_comment_text(b_edit),
                                rev_id=rev_id,
                                insert_after_para=last_vi_para,
                            )
                            
                            bilingual_accepted.remove(b_edit)
                            processed_para_indices.add(b_idx)
                    else:
                        # Monolingual or fallback: apply normally at the end of its block
                        clause_prefix = _extract_numeric_prefix(edit.get("clause_name") or "")
                        block_end_idx = _find_clause_block_end_index_path_a(all_paras, idx, clause_prefix)
                        _accept_edit_inplace(
                            para, before, after,
                            suggested=_norm_suggested(edit.get("suggested_text") or ""),
                            found=found,
                            comments_collector=comments_collector,
                            comment_text=_make_comment_text(edit),
                            rev_id=rev_id,
                            insert_after_para=all_paras[block_end_idx],
                        )
                    accepted_a.remove(edit)
                    matched = True
                    break

            # 2. Pending edits — w:del + w:ins tracked change
            if not matched:
                for edit in list(pending_a):
                    result = _find_edit_in_paragraph(para_norm, edit)
                    if result is not None:
                        before, found, after = result
                        
                        # Look ahead for bilingual counterpart in pending list
                        b_edit = None
                        b_idx = None
                        edit_id = edit.get("id")
                        if edit_id:
                            for be in list(bilingual_pending):
                                if be.get("id") == edit_id:
                                    b_idx = _find_bilingual_para_index(all_paras, idx, be)
                                    if b_idx is not None:
                                        b_edit = be
                                    break
                                    
                        if b_edit is not None and b_idx is not None:
                            # Bilingual pair matched!
                            b_para = all_paras[b_idx]
                            b_para_norm = _para_norm(b_para)
                            b_result = _find_edit_in_paragraph(b_para_norm, b_edit)
                            if b_result is not None:
                                before_b, found_b, after_b = b_result
                                
                                # Find the block boundary of b_para (the EN counterpart)
                                clause_prefix = _extract_numeric_prefix(edit.get("clause_name") or "")
                                b_block_end_idx = _find_clause_block_end_index_path_a(all_paras, b_idx, clause_prefix)
                                b_block_end_para = all_paras[b_block_end_idx]
                                
                                # 1. Apply primary edit, inserting the suffix paragraphs after the end of the EN paragraph's block
                                last_vi_para = _edit_paragraph_inplace(
                                    para, before, found, after,
                                    suggested=_norm_suggested(edit.get("suggested_text") or ""),
                                    rev_id=rev_id,
                                    comments_collector=comments_collector,
                                    comment_text=_make_comment_text(edit),
                                    insert_after_para=b_block_end_para,
                                )
                                
                                # 2. Apply bilingual edit, inserting its suffix paragraphs after the new VI paragraph
                                _edit_paragraph_inplace(
                                    b_para, before_b, found_b, after_b,
                                    suggested=_norm_suggested(b_edit.get("suggested_text") or ""),
                                    rev_id=rev_id,
                                    comments_collector=comments_collector,
                                    comment_text=_make_comment_text(b_edit),
                                    insert_after_para=last_vi_para,
                                )
                                
                                bilingual_pending.remove(b_edit)
                                processed_para_indices.add(b_idx)
                        else:
                            # Monolingual or fallback: apply normally at the end of its block
                            clause_prefix = _extract_numeric_prefix(edit.get("clause_name") or "")
                            block_end_idx = _find_clause_block_end_index_path_a(all_paras, idx, clause_prefix)
                            _edit_paragraph_inplace(
                                para, before, found, after,
                                suggested=_norm_suggested(edit.get("suggested_text") or ""),
                                rev_id=rev_id,
                                comments_collector=comments_collector,
                                comment_text=_make_comment_text(edit),
                                insert_after_para=all_paras[block_end_idx],
                            )
                        pending_a.remove(edit)
                        matched = True
                        break

            if not matched:
                for idx_a, ea in enumerate(agree_edits):
                    if idx_a in noted_agree:
                        continue
                    result = _find_edit_in_paragraph(para_norm, ea)
                    if result is not None:
                        before_a, found_a, after_a = result
                        _highlight_paragraph_inplace(
                            para, before_a, found_a, after_a,
                            rev_id=rev_id,
                            comments_collector=comments_collector,
                            comment_text=_make_comment_text(ea, is_agree=True),
                        )
                        noted_agree.add(idx_a)
                        matched = True
                        break
            idx += 1

        _log.info(
            "DOCX export (Path A): %d accepted, %d/%d pending matched, %d/%d agree highlighted",
            len(accepted_edits) - len(accepted_a),
            len(pending_edits) - len(pending_a), len(pending_edits),
            len(noted_agree), len(agree_edits),
        )
        for unmatched in pending_a:
            _log.warning(
                "  UNMATCHED pending edit [%s]: anchor=%r modified=%r",
                unmatched.get("clause_name"),
                (unmatched.get("anchor_text") or "")[:60],
                (unmatched.get("modified_text") or "")[:60],
            )
        for unmatched in accepted_a:
            _log.warning(
                "  UNMATCHED accepted edit [%s]: modified=%r",
                unmatched.get("clause_name"),
                (unmatched.get("modified_text") or "")[:60],
            )

        # ── Bilingual second pass: apply tracked changes for secondary language ──
        # For each edit that has bilingual_modified_text/bilingual_suggested_text,
        # scan all paragraphs again and apply the secondary-language tracked change.
        if bilingual_pending or bilingual_accepted:
            all_paras = list(_iter_all_paragraphs(doc))
            processed_b_indices: set[int] = set()
            idx = 0
            while idx < len(all_paras):
                if idx in processed_b_indices:
                    idx += 1
                    continue
                para = all_paras[idx]
                para_norm = _para_norm(para)
                if not para_norm:
                    idx += 1
                    continue
                
                matched_b = False
                for b_edit in list(bilingual_accepted):
                    result = _find_edit_in_paragraph(para_norm, b_edit)
                    if result is not None:
                        before, _found, after = result
                        clause_prefix = _extract_numeric_prefix(b_edit.get("clause_name") or "")
                        block_end_idx = _find_clause_block_end_index_path_a(all_paras, idx, clause_prefix)
                        _accept_edit_inplace(
                            para, before, after,
                            suggested=_norm_suggested(b_edit["suggested_text"]),
                            comments_collector=comments_collector,
                            comment_text=_make_comment_text(b_edit),
                            rev_id=rev_id,
                            insert_after_para=all_paras[block_end_idx],
                        )
                        bilingual_accepted.remove(b_edit)
                        processed_b_indices.add(block_end_idx)
                        matched_b = True
                        break
                if not matched_b:
                    for b_edit in list(bilingual_pending):
                        result = _find_edit_in_paragraph(para_norm, b_edit)
                        if result is not None:
                            before, found, after = result
                            clause_prefix = _extract_numeric_prefix(b_edit.get("clause_name") or "")
                            block_end_idx = _find_clause_block_end_index_path_a(all_paras, idx, clause_prefix)
                            _edit_paragraph_inplace(
                                para, before, found, after,
                                suggested=_norm_suggested(b_edit["suggested_text"]),
                                rev_id=rev_id,
                                comments_collector=comments_collector,
                                comment_text=_make_comment_text(b_edit),
                                insert_after_para=all_paras[block_end_idx],
                            )
                            bilingual_pending.remove(b_edit)
                            processed_b_indices.add(block_end_idx)
                            matched_b = True
                            break
                idx += 1
            _log.info(
                "DOCX export bilingual pass: %d accepted, %d pending applied",
                len([e for e in edits if e.get("bilingual_suggested_text")]) - len(bilingual_accepted),
                len([e for e in edits if e.get("bilingual_suggested_text")]) - len(bilingual_pending),
            )

    elif doc_text:
        # ── Path B: reconstruct document from plain text ──────────────────────
        doc = Document()
        lines = doc_text.splitlines()
        pending = list(tracked_edits)
        noted_agree: set[int] = set()
        i = 0

        pending_b  = list(pending_edits)
        accepted_b = list(accepted_edits)
        noted_agree_b: set[int] = set()

        deferred_insertions: dict[int, list[dict]] = {}

        while i < len(lines):
            start_i = i
            current = lines[i]
            matched_edit: dict | None = None
            split_result: tuple[str, str, str] | None = None
            consumed = 1
            is_accepted_match = False

            if current.strip():
                # Try accepted edits first (plain text replacement)
                for span in range(1, 4):
                    if i + span > len(lines):
                        break
                    window = (
                        current if span == 1
                        else " ".join(lines[i + j] for j in range(span) if lines[i + j].strip())
                    )
                    for edit in accepted_b:
                        r = _find_edit_in_paragraph(window, edit)
                        if r:
                            matched_edit = edit
                            split_result = r
                            consumed = span
                            is_accepted_match = True
                            break
                    if matched_edit:
                        break

                # Then try pending edits (tracked changes)
                if not matched_edit:
                    for span in range(1, 4):
                        if i + span > len(lines):
                            break
                        window = (
                            current if span == 1
                            else " ".join(lines[i + j] for j in range(span) if lines[i + j].strip())
                        )
                        for edit in pending_b:
                            r = _find_edit_in_paragraph(window, edit)
                            if r:
                                matched_edit = edit
                                split_result = r
                                consumed = span
                                break
                        if matched_edit:
                            break

            if matched_edit is not None and split_result is not None:
                before, found, after = split_result
                p = doc.add_paragraph()
                suggested = _norm_suggested(matched_edit.get("suggested_text") or "").replace("\r\n", "\n")
                _b_append, _b_suffix = _split_append_edit(found, suggested)
                
                clause_prefix = _extract_numeric_prefix(matched_edit.get("clause_name") or "")
                block_end_idx = _find_clause_block_end_index_path_b(lines, i + consumed - 1, clause_prefix)
                comment_body = _make_comment_text(matched_edit)
                
                if is_accepted_match:
                    if before:
                        p.add_run(before)
                    if _b_append:
                        s_lines = [l.strip() for l in suggested.split("\n") if l.strip()]
                        first_line = s_lines[0] if s_lines else ""
                        p.add_run(first_line)
                    else:
                        s_lines = [l.strip() for l in suggested.split("\n") if l.strip()]
                        p.add_run(s_lines[0] if s_lines else "")
                    if after:
                        p.add_run(after)
                        
                    info = {
                        "is_accepted": True,
                        "suggested_text": suggested,
                        "found": found,
                        "comment_body": comment_body,
                        "anchor_p": p,
                    }
                    deferred_insertions.setdefault(block_end_idx, []).append(info)
                    accepted_b = [e for e in accepted_b if e is not matched_edit]
                else:
                    if before:
                        p.add_run(before)
                    if _b_append:
                        s_lines = [l.strip() for l in suggested.split("\n") if l.strip()]
                        first_line = s_lines[0] if s_lines else ""
                        if " ".join(first_line.split()) != " ".join(found.split()):
                            _add_tracked_deletion(p, found, rev_id=rev_id)
                            _add_tracked_insertion(p, first_line, rev_id=rev_id)
                        else:
                            p.add_run(found)
                    else:
                        s_lines = [l.strip() for l in suggested.split("\n") if l.strip()]
                        _add_tracked_deletion(p, found, rev_id=rev_id)
                        _add_tracked_insertion(p, s_lines[0] if s_lines else "", rev_id=rev_id)
                    if after:
                        p.add_run(after)
                        
                    info = {
                        "is_accepted": False,
                        "suggested_text": suggested,
                        "found": found,
                        "comment_body": comment_body,
                        "anchor_p": p,
                    }
                    deferred_insertions.setdefault(block_end_idx, []).append(info)
                    pending_b = [e for e in pending_b if e is not matched_edit]
                i += consumed
            else:
                found_agree = False
                agree_consumed = 1
                if current.strip():
                    for span in range(1, 3):
                        if i + span > len(lines):
                            break
                        window = (
                            current if span == 1
                            else " ".join(lines[i + j] for j in range(span) if lines[i + j].strip())
                        )
                        for idx_a, ea in enumerate(agree_edits):
                            if idx_a in noted_agree_b:
                                continue
                            ra = _find_edit_in_paragraph(window, ea)
                            if ra:
                                before_a, matched_a, after_a = ra
                                p = doc.add_paragraph()
                                if before_a:
                                    p.add_run(before_a)
                                _add_highlighted_run(p, matched_a, color="yellow")
                                if after_a:
                                    p.add_run(after_a)
                                comment_a = _make_comment_text(ea, is_agree=True)
                                if comment_a:
                                    _add_word_comment(comments_collector, p, comment_a, rev_id=rev_id)
                                noted_agree_b.add(idx_a)
                                found_agree = True
                                agree_consumed = span
                                break
                        if found_agree:
                            break

                if found_agree:
                    i += agree_consumed
                else:
                    doc.add_paragraph(current) if current.strip() else doc.add_paragraph()
                    i += 1

            # Process any deferred insertions for the indices that have just been fully written
            for idx_to_check in range(start_i, i):
                if idx_to_check in deferred_insertions:
                    for info in deferred_insertions[idx_to_check]:
                        is_accepted = info["is_accepted"]
                        suggested = info["suggested_text"]
                        found = info["found"]
                        comment_body = info["comment_body"]
                        anchor_p = info["anchor_p"]
                        
                        _b_append, _b_suffix = _split_append_edit(found, suggested)
                        if _b_append:
                            lines_to_add = [l.strip() for l in _b_suffix.split("\n") if l.strip()]
                        else:
                            lines_to_add = [l.strip() for l in suggested.split("\n") if l.strip()][1:]
                            
                        current_p = anchor_p
                        for line in lines_to_add:
                            current_p = doc.add_paragraph()
                            if is_accepted:
                                current_p.add_run(line)
                            else:
                                _add_tracked_insertion(current_p, line, rev_id=rev_id)
                                
                        if comment_body:
                            comment_text_to_add = f"[AI — đã áp dụng] {comment_body}" if is_accepted else comment_body
                            _add_word_comment(comments_collector, current_p, comment_text_to_add, rev_id=rev_id)

        _log.info(
            "DOCX export (Path B): %d accepted, %d/%d pending matched",
            len(accepted_edits) - len(accepted_b),
            len(pending_edits) - len(pending_b), len(pending_edits),
        )
        for unmatched in pending_b:
            _log.warning(
                "  UNMATCHED edit [%s]: anchor=%r modified=%r",
                unmatched.get("clause_name"),
                (unmatched.get("anchor_text") or "")[:60],
                (unmatched.get("modified_text") or "")[:60],
            )

        # ── Bilingual second pass (Path B): append EN tracked-change paragraphs ──
        bilingual_b_pending: list[dict] = []
        bilingual_b_accepted: list[dict] = []
        for edit in edits:
            b_modified = (edit.get("bilingual_modified_text") or "").strip()
            b_suggested = (edit.get("bilingual_suggested_text") or "").strip()
            b_anchor = (edit.get("bilingual_anchor_text") or "").strip()
            if b_modified and b_suggested:
                b_edit = {
                    "id": edit.get("id", ""),
                    "clause_name": edit.get("clause_name", ""),
                    "modified_text": b_modified,
                    "anchor_text": b_anchor,
                    "suggested_text": b_suggested,
                    "reason": edit.get("reason", ""),
                    "risk_level": edit.get("risk_level", "medium"),
                    "verdict": edit.get("verdict", "disagree"),
                }
                primary = (edit.get("modified_text") or "").strip()
                if primary and primary in _applied:
                    bilingual_b_accepted.append(b_edit)
                else:
                    bilingual_b_pending.append(b_edit)

        if bilingual_b_pending or bilingual_b_accepted:
            all_paras = list(doc.paragraphs)
            processed_b_indices: set[int] = set()
            idx = 0
            while idx < len(all_paras):
                if idx in processed_b_indices:
                    idx += 1
                    continue
                para = all_paras[idx]
                para_norm = _para_norm(para)
                if not para_norm:
                    idx += 1
                    continue
                
                matched_b = False
                for b_edit in list(bilingual_b_accepted):
                    result = _find_edit_in_paragraph(para_norm, b_edit)
                    if result is not None:
                        before, _found, after = result
                        clause_prefix = _extract_numeric_prefix(b_edit.get("clause_name") or "")
                        block_end_idx = _find_clause_block_end_index_path_a(all_paras, idx, clause_prefix)
                        _accept_edit_inplace(
                            para, before, after,
                            suggested=_norm_suggested(b_edit["suggested_text"]),
                            comments_collector=comments_collector,
                            comment_text=_make_comment_text(b_edit),
                            rev_id=rev_id,
                            insert_after_para=all_paras[block_end_idx],
                        )
                        bilingual_b_accepted.remove(b_edit)
                        processed_b_indices.add(block_end_idx)
                        matched_b = True
                        break
                if not matched_b:
                    for b_edit in list(bilingual_b_pending):
                        result = _find_edit_in_paragraph(para_norm, b_edit)
                        if result is not None:
                            before, found, after = result
                            clause_prefix = _extract_numeric_prefix(b_edit.get("clause_name") or "")
                            block_end_idx = _find_clause_block_end_index_path_a(all_paras, idx, clause_prefix)
                            _edit_paragraph_inplace(
                                para, before, found, after,
                                suggested=_norm_suggested(b_edit["suggested_text"]),
                                rev_id=rev_id,
                                comments_collector=comments_collector,
                                comment_text=_make_comment_text(b_edit),
                                insert_after_para=all_paras[block_end_idx],
                            )
                            bilingual_b_pending.remove(b_edit)
                            processed_b_indices.add(block_end_idx)
                            matched_b = True
                            break
                idx += 1
            _log.info(
                "DOCX export bilingual (Path B): %d accepted, %d pending applied",
                len([e for e in edits if e.get("bilingual_suggested_text")]) - len(bilingual_b_accepted),
                len([e for e in edits if e.get("bilingual_suggested_text")]) - len(bilingual_b_pending),
            )

    else:
        doc = Document()
        p = doc.add_paragraph()
        p.add_run(
            "Không thể tải nội dung tài liệu gốc. "
            "Vui lòng mở lại tài liệu để xem đề xuất chỉnh sửa."
        ).italic = True

    buf = io.BytesIO()
    doc.save(buf)
    if comments_collector:
        buf = _inject_comments(buf, comments_collector)
    return buf.getvalue()


# ─── Legal Evaluation Report (HTML → PDF via Gotenberg) ──────────────────────

_EDIT_RISK_BADGE: dict[str, tuple[str, str]] = {
    "high": ("Cao", "#dc2626"),
    "medium": ("Trung bình", "#d97706"),
    "low": ("Thấp", "#16a34a"),
}

_CHECKLIST_GROUP_CODE_VI: dict[str, str] = {
    "fmt": "Format & Trình bày",
    "inf": "Thông tin cơ bản",
    "leg": "Pháp lý",
    "obl": "Nghĩa vụ các bên",
    "ben": "Quyền lợi",
    "pay": "Thanh toán",
    "pen": "Phạt vi phạm",
    "tim": "Thời hạn",
    "ris": "Rủi ro",
    "sum": "Tóm tắt",
    "cmp": "So sánh",
}


def _cl_category(item_id: str) -> str:
    """Extract category label from checklist item ID (e.g. 'l-pay-1' → 'Thanh toán')."""
    parts = item_id.split("-")
    if len(parts) >= 2:
        return _CHECKLIST_GROUP_CODE_VI.get(parts[1], "Khác")
    return "Khác"


_KI_LABELS_VI: dict[str, str] = {
    "Parties": "Tên công ty",
    "Legal Representative": "Người đại diện",
    "Financial": "Giá trị hợp đồng",
    "Payment": "Điều khoản thanh toán",
    "Timeline": "Ngày ký, ngày hiệu lực",
    "Penalty": "Điều khoản phạt",
    "Termination": "Điều khoản chấm dứt",
    "Jurisdiction": "Luật áp dụng",
    "Confidentiality": "Bảo mật",
    "Liability": "Trách nhiệm",
}

_PDF_CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  font-size: 14px;
  color: #1f2937;
  background: white;
  padding: 0;
}
.page {
  max-width: 100%;
}
.card {
  background: white;
  padding: 28px 40px;
  border-bottom: 1px solid #f0f1f3;
}
.section-title {
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: #374151;
  padding-bottom: 12px;
  border-bottom: 2px solid #111827;
  margin-bottom: 20px;
}
.summary-text {
  font-size: 14px;
  line-height: 1.75;
  color: #1f2937;
}
.risk-explanation-box {
  background: #fffbeb;
  border-left: 3px solid #f59e0b;
  border-radius: 4px;
  padding: 12px 16px;
  font-size: 13.5px;
  line-height: 1.7;
  color: #1f2937;
  margin-bottom: 16px;
}
.risk-score-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}
.risk-score-number {
  font-size: 42px;
  font-weight: 800;
  line-height: 1;
}
.risk-score-meta { flex: 1; }
.risk-score-label {
  display: inline-block;
  padding: 3px 14px;
  border-radius: 9999px;
  color: white;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 7px;
}
.gauge-track {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  gap: 2px;
  margin-bottom: 3px;
}
.gauge-seg { flex: 1; border-radius: 2px; }
.gauge-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #9ca3af;
}
.gauge-marker-row { position: relative; height: 6px; margin-bottom: 2px; }
.gauge-marker {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  top: -2px;
  transform: translateX(-50%);
  border: 2px solid white;
  box-shadow: 0 0 0 1px rgba(0,0,0,.15);
}
.risk-breakdown-section { margin-top: 16px; }
.breakdown-row { margin-bottom: 12px; }
.breakdown-cat {
  font-size: 13px;
  font-weight: 700;
  color: #374151;
  margin-bottom: 5px;
}
.breakdown-issues { padding-left: 16px; margin: 0; }
.breakdown-issues li {
  font-size: 13px;
  color: #4b5563;
  line-height: 1.6;
  margin-bottom: 3px;
}
.risk-factors-wrap { margin-top: 16px; }
.risk-factors-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: #6b7280;
  margin-bottom: 7px;
}
.risk-factor-tag {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 9999px;
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
  font-size: 12px;
  font-weight: 600;
  margin: 2px 3px 2px 0;
}
.ki-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.ki-table td { padding: 9px 12px; vertical-align: top; }
.ki-table tr:nth-child(even) td { background: #f9fafb; }
.ki-table .ki-label {
  font-weight: 600;
  color: #374151;
  white-space: nowrap;
  width: 34%;
}
.ki-table .ki-value { color: #1f2937; }
.ki-table .ki-empty { color: #9ca3af; font-style: italic; }
.two-col { display: flex; gap: 24px; }
.two-col > div { flex: 1; min-width: 0; }
.col-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: #6b7280;
  margin-bottom: 10px;
}
.bullet-list { margin: 0; padding-left: 18px; font-size: 13.5px; line-height: 1.7; color: #1f2937; }
.bullet-list li { margin-bottom: 5px; }
.cl-card {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 11px 14px;
  border-radius: 8px;
  border: 1px solid;
  margin-bottom: 8px;
}
.cl-card-risk  { background: #fef2f2; border-color: #fecaca; }
.cl-card-warn  { background: #fffbeb; border-color: #fde68a; }
.cl-card-pass  { background: #f0fdf4; border-color: #bbf7d0; }
.cl-icon-wrap {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: white; flex-shrink: 0; margin-top: 1px;
}
.cl-icon-risk { background: #dc2626; }
.cl-icon-warn { background: #d97706; }
.cl-icon-pass { background: #16a34a; }
.cl-label {
  font-size: 11px; font-weight: 700; color: #6b7280;
  text-transform: uppercase; letter-spacing: .05em; line-height: 1.2; margin-bottom: 3px;
}
.cl-note { font-size: 13.5px; color: #111827; line-height: 1.6; }
.cl-count-badge {
  display: inline-block; padding: 2px 9px; border-radius: 9999px;
  font-size: 12px; font-weight: 600;
}
.badge-risk { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
.badge-warn { background: #fffbeb; color: #d97706; border: 1px solid #fde68a; }
.badge-pass { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
.edit-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
.edit-table th, .edit-table td {
  border: 1px solid #e5e7eb;
  padding: 10px 12px;
  vertical-align: top;
  text-align: left;
}
.edit-table th { background: #f9fafb; font-weight: 700; font-size: 12px; color: #374151; }
.edit-table td:first-child { text-align: center; color: #9ca3af; width: 32px; font-size: 13px; }
.risk-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 9999px;
  color: white;
  font-size: 12px;
  font-weight: 600;
}
.ref-doc-name { font-size: 13px; font-weight: 600; color: #1d4ed8; margin-bottom: 7px; }
.apply-banner {
  display: flex; align-items: center; gap: 10px;
  background: #f0fdf4; border: 1px solid #bbf7d0;
  border-radius: 8px; padding: 12px 18px; margin-bottom: 16px;
}
.apply-banner-text { flex: 1; font-size: 13.5px; color: #166534; font-weight: 500; line-height: 1.5; }
.apply-banner-badge {
  padding: 3px 12px; border-radius: 9999px; flex-shrink: 0;
  background: #16a34a; color: white; font-size: 12px; font-weight: 700;
}
.edit-row-applied td { background: #f9fffe !important; }
.edit-applied-badge {
  display: inline-block; padding: 2px 8px; border-radius: 9999px;
  background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0;
  font-size: 11px; font-weight: 700; white-space: nowrap;
}
.edit-pending-badge {
  display: inline-block; padding: 2px 8px; border-radius: 9999px;
  background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa;
  font-size: 11px; font-weight: 700; white-space: nowrap;
}
.edit-new-badge {
  display: inline-block; padding: 2px 7px; border-radius: 9999px;
  background: #faf5ff; color: #7c3aed; border: 1px solid #ddd6fe;
  font-size: 10.5px; font-weight: 700; white-space: nowrap; margin-left: 5px;
}
.text-strikethrough { text-decoration: line-through; color: #9ca3af; }
.text-applied-suggested { color: #15803d; font-weight: 500; }
.footer {
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
  padding: 20px 40px;
  border-top: 1px solid #f0f1f3;
}
"""


def _esc(s: object) -> str:
    return html_lib.escape(str(s or ""), quote=True)


def _score_level(score: int) -> tuple[str, str]:
    if score >= 81:
        return "Rủi ro rất cao", "#dc2626"
    if score >= 61:
        return "Rủi ro cao", "#ea580c"
    if score >= 41:
        return "Rủi ro trung bình", "#d97706"
    if score >= 21:
        return "Rủi ro thấp", "#ca8a04"
    return "An toàn", "#16a34a"


def _section(title: str, body: str) -> str:
    return f'<div class="card"><h2 class="section-title">{title}</h2>{body}</div>'


def _bullet_list(items: list[str]) -> str:
    if not items:
        return '<p style="color:#9ca3af;font-style:italic;font-size:12px">Không phát hiện.</p>'
    lis = "".join(f"<li>{_esc(s)}</li>" for s in items if s)
    return f'<ul class="bullet-list">{lis}</ul>'


def _cl_status(c: dict) -> str:
    raw = c.get("status", "")
    if raw in ("pass", "warning", "risk"):
        return raw
    return "pass" if c.get("passed", False) else "risk"


def _cl_note(c: dict, hl_map: dict[str, dict]) -> str:
    if c.get("note"):
        return str(c["note"])
    anchor = (c.get("anchorKeyword") or "").lower()
    if anchor and anchor in hl_map:
        return hl_map[anchor].get("tooltip", "")
    return ""


def build_legal_eval_html(
    document_name: str,
    review_type: str,
    risk_score: int,
    summary: str,
    risk_explanation: str,
    key_information: list[dict],
    checklist: list[dict],
    highlights: list[dict],
    key_issues: list[str],
    missing_items: list[str],
    detected_errors: list[str],
    edits: list[dict],
    comparison: dict | None,
    reference_results: list[dict],
    suggestions: list[str],
    risk_factors: list[str] | None = None,
    risk_breakdown: list[dict] | None = None,
    compare_mode: str | None = None,
    applied_edits: dict | None = None,
    version_label: str | None = None,
) -> str:
    """Build the HTML for the Legal Evaluation Report PDF.

    Sections follow UG order:
    Header → Tóm tắt → Thông tin quan trọng → Kết quả Checklist
    → So sánh (conditional) → Tham chiếu (conditional)
    → Phân tích Rủi ro → Đề xuất chỉnh sửa → Điều khoản thiếu/Lỗi → Khuyến nghị
    """
    risk_label, risk_color = _score_level(risk_score)
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M")

    hl_map: dict[str, dict] = {
        str(h.get("keyword", "")).lower(): h
        for h in highlights
        if h.get("keyword")
    }

    apply_banner_html = ""

    # ── 1. Header ─────────────────────────────────────────────────────────────
    header_html = f"""
<div class="card" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">
  <div>
    <h1 style="font-size:18px;font-weight:700;color:#111827;margin-bottom:4px">Báo cáo Đánh giá Pháp lý</h1>
    <p style="font-size:13px;color:#374151;font-weight:500;margin-bottom:6px">{_esc(document_name)}</p>
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <span style="font-size:11px;color:#6b7280">Loại review: <strong style="color:#374151">{_esc(review_type)}</strong></span>
      <span style="font-size:11px;color:#6b7280">Ngày xuất: <strong style="color:#374151">{now_str}</strong></span>
      {f'<span style="font-size:11px;color:#6b7280">Chế độ: <strong style="color:#374151">{"So sánh tài liệu" if compare_mode else "Review đơn"}</strong></span>' if compare_mode is not None else ''}
      {f'<span style="font-size:11px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:9999px;padding:1px 9px;font-weight:600">{_esc(version_label)}</span>' if version_label else ''}
    </div>
  </div>
  <div style="text-align:right;flex-shrink:0">
    <div style="font-size:38px;font-weight:800;color:{risk_color};line-height:1">{risk_score}</div>
    <div style="font-size:10px;color:#9ca3af;margin-top:2px">/100 điểm rủi ro</div>
    <div style="margin-top:7px;display:inline-block;padding:4px 14px;border-radius:9999px;background:{risk_color};color:white;font-size:11px;font-weight:700">{_esc(risk_label)}</div>
  </div>
</div>"""

    # ── 2. Tóm tắt ────────────────────────────────────────────────────────────
    summary_html = ""
    if summary:
        summary_html = _section(
            "Tóm tắt",
            f'<p class="summary-text">{_esc(summary)}</p>',
        )

    # ── 3. Thông tin quan trọng (10 nhóm, label tiếng Việt) ──────────────────
    ki_html = ""
    if key_information:
        rows = ""
        for ki in key_information:
            group = ki.get("group", "")
            label = _KI_LABELS_VI.get(group, group)
            val = ki.get("value")
            val_cell = (
                f'<td class="ki-value">{_esc(val)}</td>'
                if val
                else '<td class="ki-empty">Không tìm thấy</td>'
            )
            rows += f'<tr><td class="ki-label">{_esc(label)}</td>{val_cell}</tr>'
        ki_html = _section(
            "Thông tin quan trọng",
            f'<table class="ki-table"><tbody>{rows}</tbody></table>',
        )

    # ── 4. Kết quả Checklist (grouped by category) ───────────────────────────
    checklist_html = ""
    if checklist:
        _STATUS_CFG = {
            "risk":    ("cl-card-risk", "cl-icon-risk", "✕"),
            "warning": ("cl-card-warn", "cl-icon-warn", "!"),
            "pass":    ("cl-card-pass", "cl-icon-pass", "✓"),
        }
        n_risk = n_warn = n_pass = 0

        # Group by category
        groups: dict[str, list[dict]] = {}
        for c in checklist:
            cat = _cl_category(c.get("id", ""))
            groups.setdefault(cat, []).append(c)

        body = ""
        for gi, (group_label, items) in enumerate(groups.items()):
            if gi > 0:
                body += '<div style="border-top:1px solid #f3f4f6;margin:12px 0"></div>'
            body += f'<p style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:8px">{_esc(group_label)}</p>'
            for c in items:
                st = _cl_status(c)
                note = _cl_note(c, hl_map)
                card_cls, icon_cls, icon_char = _STATUS_CFG.get(st, _STATUS_CFG["risk"])
                if st == "risk":
                    n_risk += 1
                elif st == "warning":
                    n_warn += 1
                else:
                    n_pass += 1
                note_block = f'<p class="cl-note">{_esc(note)}</p>' if note else ""
                body += f"""
<div class="cl-card {card_cls}">
  <div class="cl-icon-wrap {icon_cls}">{icon_char}</div>
  <div style="flex:1;min-width:0">
    <p class="cl-label">{_esc(c.get("label", ""))}</p>
    {note_block}
  </div>
</div>"""

        badges = ""
        if n_risk:
            badges += f'<span class="cl-count-badge badge-risk" style="margin-right:4px">{n_risk} Rủi ro</span>'
        if n_warn:
            badges += f'<span class="cl-count-badge badge-warn" style="margin-right:4px">{n_warn} Cảnh báo</span>'
        if n_pass:
            badges += f'<span class="cl-count-badge badge-pass">{n_pass} Đạt</span>'

        header_row = f"""
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
  <span style="font-size:12px;font-weight:600;color:#374151">{len(checklist)} mục được kiểm tra</span>
  <div>{badges}</div>
</div>"""
        checklist_html = _section("Kết quả Checklist", header_row + body)

    # ── 5. Kết quả So sánh (chỉ khi compare_mode được bật) ───────────────────
    comparison_html = ""
    if compare_mode:
        cmp = comparison or {}
        differences = [str(d) for d in cmp.get("differences", []) if d]
        missing_clauses = [str(m) for m in cmp.get("missingClauses", []) if m]
        conflict_terms = [str(t) for t in cmp.get("conflictTerms", []) if t]

        overview_block = ""
        if differences or missing_clauses or conflict_terms:
            cols = ""
            if differences:
                cols += f'<div style="margin-bottom:14px"><p class="col-title">Khác biệt so với mẫu</p>{_bullet_list(differences)}</div>'
            if missing_clauses:
                cols += f'<div style="margin-bottom:14px"><p class="col-title">Điều khoản thiếu so với mẫu</p>{_bullet_list(missing_clauses)}</div>'
            if conflict_terms:
                cols += f'<div><p class="col-title">Điều khoản xung đột</p>{_bullet_list(conflict_terms)}</div>'
            overview_block = f'<div style="margin-bottom:14px">{cols}</div>'
        elif not overview_block:
            overview_block = '<p style="color:#9ca3af;font-style:italic;font-size:12px;margin-bottom:14px">Không phát hiện khác biệt cấu trúc.</p>'

        mode_badge = (
            '<span style="font-size:11px;padding:2px 9px;border-radius:9999px;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;font-weight:600;margin-left:8px">Track Changes</span>'
            if compare_mode == "tracked" else
            '<span style="font-size:11px;padding:2px 9px;border-radius:9999px;background:#f5f3ff;color:#5b21b6;border:1px solid #ddd6fe;font-weight:600;margin-left:8px">Semantic</span>'
        )
        comparison_html = _section(
            f"Kết quả So sánh",
            f'<div style="margin-bottom:12px">{mode_badge}</div>' + overview_block,
        )

    # ── 6. Kết quả Tham chiếu nội bộ ─────────────────────────────────────────
    ref_html = ""
    if reference_results:
        blocks = ""
        for ref in reference_results:
            name = _esc(ref.get("reference_name", ""))
            findings = [
                f.get("text", "") if isinstance(f, dict) else str(f)
                for f in ref.get("findings", []) if f
            ]
            lis = (
                "".join(f"<li>{_esc(f)}</li>" for f in findings)
                if findings
                else '<li style="color:#9ca3af;font-style:italic">Không có phát hiện.</li>'
            )
            blocks += f"""
<div style="margin-bottom:14px">
  <p class="ref-doc-name">{name}</p>
  <ul class="bullet-list">{lis}</ul>
</div>"""
        ref_html = _section("Kết quả Đối chiếu Tài liệu Tham chiếu", blocks)

    # ── 7. Phân tích Rủi ro ───────────────────────────────────────────────────
    risk_html = ""
    if risk_explanation or risk_breakdown or risk_factors:
        # Risk explanation
        explanation_block = ""
        if risk_explanation:
            explanation_block = f'<div class="risk-explanation-box">{_esc(risk_explanation)}</div>'

        # Risk breakdown by category
        breakdown_block = ""
        if risk_breakdown:
            rows_html = ""
            for rb in risk_breakdown:
                cat = _esc(rb.get("category", ""))
                issues = [str(i) for i in (rb.get("issues") or []) if i]
                lis_html = "".join(f"<li>{_esc(i)}</li>" for i in issues) if issues else ""
                rows_html += f"""
<div class="breakdown-row">
  <p class="breakdown-cat">{cat}</p>
  {f'<ul class="breakdown-issues">{lis_html}</ul>' if lis_html else ''}
</div>"""
            breakdown_block = (
                f'<div class="risk-breakdown-section">'
                f'<p style="font-size:10.5px;font-weight:700;text-transform:uppercase;'
                f'letter-spacing:.06em;color:#6b7280;margin-bottom:10px">Phân loại theo danh mục</p>'
                f'{rows_html}</div>'
            )

        # Risk factors tags
        factors_block = ""
        if risk_factors:
            tags = "".join(
                f'<span class="risk-factor-tag">{_esc((f.split(" – ")[0].strip() if " – " in f else f.split(" - ")[0].strip() if " - " in f else f).upper())}</span>'
                for f in risk_factors if f
            )
            if tags:
                factors_block = (
                    '<div class="risk-factors-wrap">'
                    '<p class="risk-factors-label">Yếu tố rủi ro</p>'
                    f'{tags}</div>'
                )

        risk_html = _section(
            "Phân tích Rủi ro &amp; Điểm rủi ro",
            explanation_block + breakdown_block + factors_block,
        )

    # ── 8. Đề xuất chỉnh sửa ─────────────────────────────────────────────────
    edits_html = ""
    if edits:
        is_compare = bool(compare_mode)
        section_title = "Đánh giá Điều chỉnh so với Mẫu" if is_compare else "Đề xuất Chỉnh sửa của AI"

        _ae = applied_edits or {}
        col2_header = "Nội dung điều khoản (Mẫu → Tài liệu)" if is_compare else "Điều khoản cần chỉnh sửa"

        _CAT_META = [
            ("improve", "Cải thiện chất lượng điều khoản", "#1d4ed8", "#eff6ff", "#bfdbfe"),
            ("reduce",  "Giảm thiểu rủi ro",               "#b45309", "#fffbeb", "#fde68a"),
            ("rewrite", "Viết lại điều khoản",              "#6d28d9", "#f5f3ff", "#ddd6fe"),
        ]

        def _render_edit_row(seq: int, e: dict) -> str:
            rl, rc = _EDIT_RISK_BADGE.get(e.get("risk_level", "medium"), ("Trung bình", "#d97706"))
            verdict = e.get("verdict", "disagree")
            vlabel = "Chấp nhận" if verdict == "agree" else "Cần chỉnh sửa"
            vcolor = "#16a34a" if verdict == "agree" else "#dc2626"
            original = _esc(e.get("original_text", ""))
            modified_raw = e.get("modified_text", "")
            modified = _esc(modified_raw)
            reason = _esc(e.get("reason", ""))
            suggested_raw = e.get("suggested_text") or "—"
            suggested = _esc(suggested_raw)
            clause = _esc(e.get("clause_name", ""))
            bilingual_suggested = _esc(e.get("bilingual_suggested_text") or "")
            bilingual_modified = _esc(e.get("bilingual_modified_text") or "")
            is_new = bool(e.get("is_quick_action"))
            new_badge = '<span class="edit-new-badge">&#10022; Mới</span>' if is_new else ""

            is_applied = bool(_ae and modified_raw in _ae)
            row_class = ' class="edit-row-applied"' if is_applied else ""
            status_badge = (
                '<span class="edit-applied-badge">&#10003; Đã áp dụng</span>'
                if is_applied else
                '<span class="edit-pending-badge">&#8987; Chưa xử lý</span>'
            )

            if is_compare:
                content_cell = (
                    f'<td><strong>{clause}</strong>{new_badge}'
                    + (f'<div style="color:#6b7280;font-size:11px;margin-top:3px"><em>Mẫu:</em> {original}</div>' if original else '')
                    + f'<div style="margin-top:4px"><em>Tài liệu:</em> {modified}</div>'
                    + (f'<div style="margin-top:3px;color:#6b7280;font-size:11px"><em>EN:</em> {bilingual_modified}</div>' if bilingual_modified else '')
                    + '</td>'
                )
            else:
                content_cell = (
                    f'<td><strong>{clause}</strong>{new_badge}'
                    + f'<div style="margin-top:4px;color:#374151">{modified}</div>'
                    + (f'<div style="margin-top:3px;font-size:11px;color:#6b7280">{bilingual_modified}</div>' if bilingual_modified else '')
                    + '</td>'
                )

            suggested_display = f'<span class="text-applied-suggested">{suggested}</span>' if (is_applied and suggested_raw != "—") else suggested
            if bilingual_suggested:
                bi_color = "#15803d" if is_applied else "#065f46"
                suggested_cell = (
                    f'{suggested_display}'
                    f'<div style="margin-top:5px;padding-top:5px;border-top:1px solid #d1fae5;color:{bi_color};font-size:11px"><em>EN:</em> {bilingual_suggested}</div>'
                )
            else:
                suggested_cell = suggested_display

            return (
                f'<tr{row_class}>'
                f'<td>{seq}</td>'
                f'{content_cell}'
                f'<td><span class="risk-pill" style="background:{rc}">{_esc(rl)}</span><div style="margin-top:5px">{status_badge}</div></td>'
                f'<td><span style="font-weight:600;color:{vcolor}">{vlabel}</span><div style="color:#374151;font-size:11px;margin-top:3px">{reason}</div></td>'
                f'<td style="color:#374151">{suggested_cell}</td>'
                f'</tr>'
            )

        def _render_group_table(group_edits: list[dict], col2: str) -> str:
            rows = "".join(_render_edit_row(i + 1, e) for i, e in enumerate(group_edits))
            return (
                f'<table class="edit-table">'
                f'<thead><tr><th>#</th><th>{col2}</th><th>Mức rủi ro</th><th>Đánh giá Legal AI</th><th>Văn bản đề xuất</th></tr></thead>'
                f'<tbody>{rows}</tbody>'
                f'</table>'
            )

        docx_note = (
            '<p style="font-size:11px;font-style:italic;color:#6b7280;margin-bottom:14px">'
            'Tải file DOCX để xem đề xuất dưới dạng Track Changes và Accept/Reject trực tiếp trong Word.</p>'
        )

        # Tách 3 nhóm cho mọi mode (kể cả compare) — luôn hiển thị cả 3
        body = docx_note
        for cat_key, cat_title, cat_color, cat_bg, cat_border in _CAT_META:
            group = [e for e in edits if e.get("suggestion_category", "improve") == cat_key]
            empty_msg = (
                f'<p style="font-size:13px;color:#9ca3af;font-style:italic;padding:14px 0">Không có mục nào trong nhóm này.</p>'
                if not group else ""
            )
            body += (
                f'<div style="margin-bottom:28px">'
                f'<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'
                f'<span style="display:inline-block;width:4px;height:18px;border-radius:2px;background:{cat_color};flex-shrink:0"></span>'
                f'<span style="font-size:13px;font-weight:800;color:{cat_color};text-transform:uppercase;letter-spacing:.04em">{cat_title}</span>'
                f'<span style="font-size:12px;color:#9ca3af;font-weight:500">({len(group)} mục)</span>'
                f'</div>'
                + (empty_msg if empty_msg else _render_group_table(group, col2_header))
                + '</div>'
            )

        edits_html = _section(section_title, body)

    # ── 9. Điều khoản thiếu + Lỗi kỹ thuật ──────────────────────────────────
    issues_html = ""
    if missing_items or detected_errors:
        blocks = ""
        if missing_items:
            blocks += f'<div style="margin-bottom:14px"><p class="col-title">Điều khoản còn thiếu</p>{_bullet_list(missing_items)}</div>'
        if detected_errors:
            lis = "".join(f"<li>{_esc(e)}</li>" for e in detected_errors if e)
            blocks += f'<div><p class="col-title">Lỗi kỹ thuật / trình bày</p><ul class="bullet-list">{lis}</ul></div>'
        issues_html = _section("Điều khoản thiếu &amp; Lỗi kỹ thuật", blocks)

    # ── 10. Khuyến nghị ───────────────────────────────────────────────────────
    suggestions_html = ""
    if suggestions:
        lis = "".join(f"<li>{_esc(s)}</li>" for s in suggestions if s)
        suggestions_html = _section(
            "Khuyến nghị tổng thể",
            f'<ul class="bullet-list" style="font-size:12.5px">{lis}</ul>',
        )

    # ── Footer ────────────────────────────────────────────────────────────────
    footer = (
        f'<div class="footer">'
        f"Tự động sinh bởi Lumina Document Review &nbsp;·&nbsp; "
        f'{datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")}'
        f"</div>"
    )

    return (
        f'<!DOCTYPE html><html lang="vi"><head>'
        f'<meta charset="utf-8"/>'
        f'<title>Báo cáo Đánh giá — {_esc(document_name)}</title>'
        f"<style>{_PDF_CSS}</style>"
        f"</head><body>"
        f'<div class="page">'
        f"{header_html}"
        f"{summary_html}"
        f"{ki_html}"
        f"{checklist_html}"
        f"{comparison_html}"
        f"{ref_html}"
        f"{risk_html}"
        f"{edits_html}"
        f"{issues_html}"
        f"{suggestions_html}"
        f"{footer}"
        f"</div></body></html>"
    )