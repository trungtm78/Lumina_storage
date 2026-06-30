"""Phase 8 — helper thao tác DOCX cho generator (tách khỏi route generator.py).

PURE: thao tác trên object python-docx + dict, không DB/router/service. Patch DOCX gốc theo
chỉnh sửa TipTap (difflib) + thay {placeholder}, giữ nguyên formatting.
"""
from io import BytesIO


def _merge_runs(paragraph) -> None:
    if not paragraph.runs:
        return
    full = "".join(r.text for r in paragraph.runs)
    paragraph.runs[0].text = full
    for run in paragraph.runs[1:]:
        run._element.getparent().remove(run._element)


def _set_para_text(para, new_text: str) -> None:
    """Replace all text in a paragraph's runs while keeping the first run's formatting.
    Clears subsequent runs (text = '') rather than deleting them so run-level formatting
    nodes (rPr) are preserved in the XML.

    If the paragraph has no runs (e.g. originally empty paragraph the user added text to),
    a new run is inserted so the text is not silently dropped.
    """
    if not para.runs:
        para.add_run(new_text)
        return
    para.runs[0].text = new_text
    for run in para.runs[1:]:
        run.text = ""


def _apply_html_edits_to_docx(
    template_bytes: bytes,
    edited_html: str,
    field_values: dict[str, str],
) -> bytes:
    """Apply TipTap manual edits to the ORIGINAL DOCX template, then substitute fields.

    This is the correct path when session.template_id is available:
    - Preserve ALL DOCX formatting (fonts, styles, page layout, headers/footers)
    - Use difflib to detect which paragraphs changed vs original template
    - For changed paragraphs: replace text using _set_para_text (keeps first-run format)
    - For unchanged paragraphs: apply {placeholder} → value substitution via _replace_in_runs
    - Fallback _merge_runs when a token is split across runs

    Rationale: HTML→DOCX conversion (htmldocx, LibreOffice) creates a brand-new DOCX
    with no original styles. Patching the original DOCX at the paragraph level
    preserves all formatting with only the text content updated.

    IMPORTANT — body-only alignment:
    Header/footer paragraphs are intentionally excluded from the difflib index because
    TipTap HTML output does NOT include them.  Including them shifts every index and
    causes completely wrong paragraph mappings (e.g. user-edited text in paragraph N
    ends up applied to paragraph 0 or vice-versa).  Field substitution for headers and
    footers is applied separately after the diff pass.
    """
    import re
    import difflib
    from bs4 import BeautifulSoup
    from docx import Document as DocxDocument
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph

    def _norm(t: str) -> str:
        """Collapse all whitespace (incl. non-breaking space \xa0) to single space."""
        t = t.replace("\xa0", " ")
        return re.sub(r"\s+", " ", t).strip()

    soup = BeautifulSoup(edited_html, "html.parser")
    html_texts: list[str] = []
    for el in soup.find_all(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th"]):
        if not el.find(["p", "h1", "h2", "h3", "h4", "li", "td", "th"]):
            # get_text("") avoids inserting extra spaces between <span> children
            # that would differ from python-docx's run concatenation.
            html_texts.append(_norm(el.get_text("")))

    docx = DocxDocument(BytesIO(template_bytes))

    # ── Body-only paragraph walker ─────────────────────────────────────────────
    # Must match the order mammoth.js / TipTap produces: body paragraphs and
    # table-cell paragraphs in XML flow order.  Headers/footers are excluded here
    # and handled separately below.
    _P = qn("w:p")
    _TBL = qn("w:tbl")
    _TR = qn("w:tr")
    _TC = qn("w:tc")

    def _walk_body(elem):
        for child in elem:
            if child.tag == _P:
                yield Paragraph(child, elem)
            elif child.tag == _TBL:
                for tr in child:
                    if tr.tag == _TR:
                        for tc in tr:
                            if tc.tag == _TC:
                                yield from _walk_body(tc)

    docx_paras = list(_walk_body(docx.element.body))
    docx_texts = [_norm(p.text) for p in docx_paras]

    def _subst_para(para) -> None:
        for key, val in field_values.items():
            token = "{" + key + "}"
            if token in para.text:
                if not _replace_in_runs(para, token, val):
                    _merge_runs(para)
                    _replace_in_runs(para, token, val)

    matcher = difflib.SequenceMatcher(None, docx_texts, html_texts, autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "replace":
            for i, j in zip(range(i1, i2), range(j1, j2)):
                new_text = html_texts[j]
                for key, val in field_values.items():
                    new_text = new_text.replace("{" + key + "}", val)
                _set_para_text(docx_paras[i], new_text)
            # Handle unmatched DOCX paras when replace block counts differ.
            # zip truncates to the shorter side, leaving extra DOCX paras untouched.
            matched = min(i2 - i1, j2 - j1)
            for i in range(i1 + matched, i2):
                _subst_para(docx_paras[i])
        elif op in ("equal", "delete"):
            # "equal"  — unchanged paragraph: substitute {placeholder} tokens only
            # "delete" — safety net for ordering mismatches: paragraph exists in DOCX
            #            but has no HTML counterpart; still substitute fields so that
            #            {placeholder} tokens are never left unreplaced in the output.
            for i in range(i1, i2):
                _subst_para(docx_paras[i])

    # Final sweep: catch any {field} tokens still present after opcode processing.
    # Covers edge cases where difflib alignment left a para unvisited.
    for para in docx_paras:
        _subst_para(para)

    # Apply field substitution to header/footer paragraphs separately.
    # These are not part of the difflib alignment (TipTap doesn't export them),
    # but they may contain {field} tokens (e.g. company name in document header).
    for section in docx.sections:
        for part in [section.header, section.footer]:
            if part:
                for para in part.paragraphs:
                    _subst_para(para)

    output = BytesIO()
    docx.save(output)
    return output.getvalue()


def _replace_in_runs(paragraph, value: str, replacement: str) -> bool:
    """Replace `value` → `replacement` inside a SINGLE run if it fits there,
    preserving that run's formatting (bold/font/etc.). Replaces ALL occurrences.

    Returns True if at least one run was changed. If the value spans multiple
    runs (Word often splits text), no run contains it whole → returns False so
    the caller can fall back to merging the paragraph.
    """
    if not value:
        return False
    replaced = False
    for run in paragraph.runs:
        if value in run.text:
            run.text = run.text.replace(value, replacement)
            replaced = True
    return replaced


def _field_is_required(field: dict) -> bool:
    """Resolve required-ness for a template field.

    `required` was introduced in the Phase 1 schema upgrade. Older fields lack
    the key — in that case fall back to the legacy heuristic where any field
    that isn't a free-text `blank` is required.
    """
    explicit = field.get("required")
    if explicit is not None:
        return bool(explicit)
    return field.get("type") != "blank"


def _validate_field_values(
    template_fields: list[dict],
    field_values: dict[str, str],
) -> list[dict[str, str]]:
    """Return a list of validation issues, empty if the payload is valid.

    Each issue is `{"placeholder": ..., "code": ..., "message": ...}`. Codes:
      - `required_missing`: field marked required but value is empty/missing
      - `select_invalid`:   value supplied for a `select` field is not in `options`
    """
    issues: list[dict[str, str]] = []
    for field in template_fields:
        placeholder = field.get("placeholder") or ""
        if not placeholder:
            continue
        # Normalize: placeholders may be stored as "{key}" or "key" — try both
        placeholder_key = placeholder.strip("{}")
        raw = field_values.get(placeholder_key, field_values.get(placeholder, ""))
        value = raw.strip() if isinstance(raw, str) else raw

        if _field_is_required(field) and not value:
            issues.append(
                {
                    "placeholder": placeholder,
                    "code": "required_missing",
                    "message": f"Trường '{field.get('label') or placeholder}' bắt buộc.",
                }
            )
            continue  # skip type-specific check when value is missing

        if field.get("type") == "select":
            options = field.get("options") or []
            if value and options and value not in options:
                issues.append(
                    {
                        "placeholder": placeholder,
                        "code": "select_invalid",
                        "message": (
                            f"Trường '{field.get('label') or placeholder}' "
                            f"phải là một trong: {', '.join(options)}."
                        ),
                    }
                )
    return issues


def _iter_all_paragraphs(docx):
    """Iterate all paragraphs in document flow order.

    Body paragraphs and table-cell paragraphs are yielded in the same order they
    appear in the XML — i.e. paragraphs that come *before* a table are yielded
    before table-cell paragraphs, and paragraphs *after* a table are yielded after.
    This matches the order that mammoth.js → TipTap produces in HTML, which is
    critical for difflib alignment inside _apply_html_edits_to_docx.

    The previous implementation yielded docx.paragraphs (ALL body paras first,
    including those after tables) then ALL table cells — creating an ordering
    mismatch that caused difflib to produce wrong opcodes.
    """
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph

    _P = qn("w:p")
    _TBL = qn("w:tbl")
    _TR = qn("w:tr")
    _TC = qn("w:tc")

    def _walk(elem):
        for child in elem:
            if child.tag == _P:
                yield Paragraph(child, elem)
            elif child.tag == _TBL:
                for tr in child:
                    if tr.tag == _TR:
                        for tc in tr:
                            if tc.tag == _TC:
                                # Recurse so nested tables are also walked in flow order
                                yield from _walk(tc)

    yield from _walk(docx.element.body)
    for section in docx.sections:
        for part in [section.header, section.footer]:
            if part:
                for para in part.paragraphs:
                    yield para
