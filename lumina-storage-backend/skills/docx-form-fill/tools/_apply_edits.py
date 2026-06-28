"""Apply edits to a .docx document — field-based, para-based, or text-based.

Three edit types:
1. field_id + value  → fill blank field by ID (from parse_document fields list)
2. para_id + old/new → edit specific paragraph by ID (from parse_document paragraphs list)
3. context + old/new → fallback text matching (legacy)
"""

from __future__ import annotations

import re
from io import BytesIO
from pathlib import Path
import sys

# Allow sibling imports within skill tools
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _patterns import BLANK_PAT as _BLANK_PAT, normalise as _normalise


def _merge_runs(paragraph) -> None:
    if not paragraph.runs:
        return
    full_text = "".join(r.text for r in paragraph.runs)
    paragraph.runs[0].text = full_text
    for run in paragraph.runs[1:]:
        run.text = ""


# ── Paragraph lookup helpers ───────────────────────────────────────────


def _resolve_table_path(tables, path_parts: list[tuple[str, int]]):
    """Walk a chain of table/row/cell/nested-table indices to reach the final cell.

    path_parts is a list of (type, index) tuples, e.g.:
      [("t", 0), ("r", 1), ("c", 2), ("nt", 0), ("r", 0), ("c", 1)]
    Returns the final cell object, or None.
    """
    current_tables = tables
    cell = None
    i = 0
    while i < len(path_parts):
        kind, idx = path_parts[i]
        if kind == "t" or kind == "nt":
            if idx >= len(current_tables):
                return None
            table = current_tables[idx]
            i += 1
        elif kind == "r":
            ri = idx
            i += 1
            if i >= len(path_parts):
                return None
            _, ci = path_parts[i]
            i += 1
            try:
                cell = table.rows[ri].cells[ci]
                current_tables = cell.tables
            except (IndexError, AttributeError):
                return None
        else:
            return None
    return cell


def _get_paragraph_by_para_id(doc, para_id: str):
    """Lookup paragraph by para_id.

    Supported formats:
      p{i}                              - body paragraph
      t{t}r{r}c{c}p{p}                 - table cell paragraph
      t{t}r{r}c{c}nt{n}r{r}c{c}p{p}   - nested table paragraph
      s{s}h{p} / s{s}f{p}              - header/footer paragraph
      s{s}ht{t}r{r}c{c}p{p}            - header table paragraph
    """
    # Body paragraph: p{index}
    m = re.match(r'^p(\d+)$', para_id)
    if m:
        idx = int(m.group(1))
        if 0 <= idx < len(doc.paragraphs):
            return doc.paragraphs[idx]
        return None

    # Header/footer paragraph: s{section}h{para} or s{section}f{para}
    m = re.match(r'^s(\d+)([hf])(\d+)$', para_id)
    if m:
        si, part, pi = int(m.group(1)), m.group(2), int(m.group(3))
        try:
            section = doc.sections[si]
            container = section.header if part == "h" else section.footer
            return container.paragraphs[pi]
        except (IndexError, AttributeError):
            return None

    # Header/footer table: s{s}ht{t}r{r}c{c}p{p} or s{s}ft{t}...
    m = re.match(r'^s(\d+)([hf])t(.+)p(\d+)$', para_id)
    if m:
        si, part = int(m.group(1)), m.group(2)
        table_path_str, pi = m.group(3), int(m.group(4))
        try:
            section = doc.sections[si]
            container = section.header if part == "h" else section.footer
            # Parse remaining path (e.g. "0r1c2" or "0r1c2nt0r0c1")
            path_parts = re.findall(r'(t|nt|r|c)(\d+)', f"t{table_path_str}")
            path_parts = [(k, int(v)) for k, v in path_parts]
            cell = _resolve_table_path(container.tables, path_parts)
            if cell:
                return cell.paragraphs[pi]
        except (IndexError, AttributeError):
            pass
        return None

    # Table paragraph (simple or nested): t{t}r{r}c{c}[nt{n}r{r}c{c}...]p{p}
    m = re.match(r'^(t.+)p(\d+)$', para_id)
    if m:
        table_path_str, pi = m.group(1), int(m.group(2))
        path_parts = re.findall(r'(t|nt|r|c)(\d+)', table_path_str)
        path_parts = [(k, int(v)) for k, v in path_parts]
        cell = _resolve_table_path(doc.tables, path_parts)
        if cell:
            try:
                return cell.paragraphs[pi]
            except IndexError:
                return None
        return None

    return None


def _get_paragraph_by_body_index(doc, idx: int):
    """Get body paragraph by index."""
    if 0 <= idx < len(doc.paragraphs):
        return doc.paragraphs[idx]
    return None


# ── Edit application ───────────────────────────────────────────────────


def _apply_field_edit(doc, field_id: str, value: str, fields_map: dict) -> bool:
    """Fill a blank field by field_id — precise, using position index."""
    field = fields_map.get(field_id)
    if not field:
        return False

    para = _get_paragraph_by_para_id(doc, field["para_id"])
    if not para:
        if "para_idx" in field:
            para = _get_paragraph_by_body_index(doc, field["para_idx"])
    if not para:
        return False

    _merge_runs(para)
    text = para.text
    position = field.get("position", 0)
    blank = field.get("blank", "")

    # Strategy 1: Find blank pattern closest to stored position
    blanks = list(_BLANK_PAT.finditer(text))
    if blanks:
        best = min(blanks, key=lambda m: abs(m.start() - position))
        new_text = text[:best.start()] + value + text[best.end():]
        para.runs[0].text = new_text
        return True

    # Strategy 2: Field already filled (no blanks left) — find the OLD value by position
    # The field was at `position` originally, text around it should still be recognizable
    # Replace the non-label content near that position
    # For simplicity: if there's only one "data segment" between labels, replace it
    if blank and blank in text:
        # Exact old blank still in text somehow
        para.runs[0].text = text.replace(blank, value, 1)
        return True

    # Strategy 3: Brute force — check if this is an incremental edit on already-filled field
    # Parse the paragraph to find segments that look like filled values (not labels/punctuation)
    # and replace the one closest to position
    # For now: just try to replace at the original position region
    label_end = position  # where the blank used to start
    # Find the label before this position (text ending with : or similar)
    colon_before = text.rfind(":", 0, position)
    if colon_before >= 0:
        label_end = colon_before + 1
        # Find the next label or end of text
        next_label = len(text)
        for sep in [":", " Cơ quan", " Ngày", " Nơi"]:
            idx = text.find(sep, label_end + 1)
            if idx > label_end:
                next_label = min(next_label, idx)
        # Replace the content between label_end and next_label
        old_value = text[label_end:next_label].strip()
        if old_value:
            para.runs[0].text = text[:label_end] + value + text[next_label:]
            return True

    return False


def _apply_para_edit(doc, para_id: str, old: str | None, new: str) -> bool:
    """Edit a specific paragraph by para_id."""
    para = _get_paragraph_by_para_id(doc, para_id)
    if not para:
        return False

    _merge_runs(para)
    text = para.text

    if old:
        # Replace substring within paragraph
        if old in text:
            para.runs[0].text = text.replace(old, new, 1)
            return True
        # Try normalised match
        norm_old = _normalise(old)
        norm_text = _normalise(text)
        if norm_old in norm_text:
            # Replace longest blank in paragraph
            blanks = list(_BLANK_PAT.finditer(text))
            if blanks:
                best = max(blanks, key=lambda m: len(m.group()))
                para.runs[0].text = text[:best.start()] + new + text[best.end():]
                return True
        return False
    else:
        # Replace entire paragraph text
        para.runs[0].text = new
        return True


def _apply_context_edit(doc, context: str, old: str, new: str) -> bool:
    """Legacy fallback — find paragraph by context + old text matching."""
    def _paragraphs():
        for p in doc.paragraphs:
            yield p
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    for p in cell.paragraphs:
                        yield p

    def _ctx_matches(para_text: str) -> int:
        """Return match score (0 = no match, higher = better)."""
        if not context:
            return 1
        ctx = context[:80]
        if ctx in para_text:
            return len(ctx)
        norm_p = _normalise(para_text)
        norm_c = _normalise(ctx)
        if norm_c in norm_p:
            return len(norm_c)
        return 0

    # Find best matching paragraph
    candidates = []
    for para in _paragraphs():
        _merge_runs(para)
        text = para.text
        if not text:
            continue
        if old and old in text:
            score = _ctx_matches(text)
            if score > 0:
                candidates.append((score, para, text))

    if candidates:
        candidates.sort(key=lambda x: x[0], reverse=True)
        _, best_para, best_text = candidates[0]
        best_para.runs[0].text = best_text.replace(old, new, 1)
        return True

    # Normalised blank match
    if old and _NORM_BLANK.search(old):
        norm_old = _normalise(old)
        for para in _paragraphs():
            text = para.text
            if not text:
                continue
            score = _ctx_matches(text)
            if score == 0:
                continue
            if norm_old in _normalise(text):
                blanks = list(_BLANK_PAT.finditer(text))
                if blanks:
                    best = max(blanks, key=lambda m: len(m.group()))
                    para.runs[0].text = text[:best.start()] + new + text[best.end():]
                    return True

    # Context match + replace longest blank
    if context:
        for para in _paragraphs():
            text = para.text
            if not text or _ctx_matches(text) == 0:
                continue
            blanks = list(_BLANK_PAT.finditer(text))
            if blanks:
                best = max(blanks, key=lambda m: len(m.group()))
                para.runs[0].text = text[:best.start()] + new + text[best.end():]
                return True

    return False


# ── Main entry ─────────────────────────────────────────────────────────


async def run(args: dict, ctx) -> dict:
    """Apply edits to document and save rendered copy + PDF preview."""
    from docx import Document

    document_id: str = args["document_id"]
    edits: list[dict] = args.get("edits", [])
    fields_list: list[dict] = args.get("fields", [])

    doc_bytes = await ctx.get_document_bytes(document_id)
    doc = Document(BytesIO(doc_bytes))

    # Build fields lookup map (re-parse if fields not provided)
    fields_map: dict[str, dict] = {}
    if fields_list:
        fields_map = {f["id"]: f for f in fields_list}
    else:
        # Auto-parse fields from document (same logic as parse_document)
        _blank_re = re.compile(r'[.…]{3,}|_{3,}|-{3,}', re.UNICODE)
        fc = 0
        for pi, para in enumerate(doc.paragraphs):
            _merge_runs(para)
            for m in _blank_re.finditer(para.text):
                fid = f"f{fc}"
                fields_map[fid] = {
                    "id": fid,
                    "para_id": f"p{pi}",
                    "para_idx": pi,
                    "blank": m.group()[:50],
                    "position": m.start(),
                }
                fc += 1

    applied_count = 0
    failed_edits: list[dict] = []

    # Sort field_id edits by position DESCENDING within same paragraph
    # so replacing later positions first doesn't shift earlier positions
    def _edit_sort_key(e):
        if "field_id" in e:
            f = fields_map.get(e["field_id"], {})
            return (f.get("para_id", ""), -(f.get("position", 0)))
        return ("zzz", 0)  # non-field edits last
    edits = sorted(edits, key=_edit_sort_key)

    for edit in edits:
        success = False

        if "field_id" in edit and "value" in edit:
            # Type 1: Fill blank field by ID
            success = _apply_field_edit(doc, edit["field_id"], edit["value"], fields_map)

        elif "para_id" in edit:
            # Type 2: Edit paragraph by ID
            success = _apply_para_edit(doc, edit["para_id"], edit.get("old"), edit.get("new", ""))

        elif "context" in edit or "old" in edit:
            # Type 3: Legacy text matching
            success = _apply_context_edit(
                doc, edit.get("context", ""), edit.get("old", ""), edit.get("new", "")
            )

        if success:
            applied_count += 1
        else:
            failed_edits.append(edit)

    # Save rendered document
    output = BytesIO()
    doc.save(output)
    rendered_bytes = output.getvalue()

    rendered_id = await ctx.save_rendered_document(rendered_bytes, document_id)

    # Generate PDF preview via Gotenberg
    preview_pdf_id = None
    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    pdf_bytes = await ctx.convert_to_pdf(rendered_bytes, mime)
    if pdf_bytes:
        preview_pdf_id = await ctx.save_pdf_preview(pdf_bytes, document_id)

    return {
        "rendered_document_id": str(rendered_id),
        "preview_pdf_id": str(preview_pdf_id) if preview_pdf_id else None,
        "applied_count": applied_count,
        "failed_edits": failed_edits,
    }
