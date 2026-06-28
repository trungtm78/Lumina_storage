"""Docx fill pipeline — Code detect fields + LLM fill values.

Agent calls: run_script("skills/docx-form-fill/tools/fill.py", '{"document_id": "...", "user_info": "..."}')

Pipeline:
1. Load docx (code)
2. Extract ALL text with location tags (code)
3. Detect ALL fillable fields by code (regex + heuristics)
4. LLM: field list + user_info → filled values (1 call, tiny input)
5. Apply values back to docx (code)
6. Save rendered docx + PDF preview (code)
"""

from __future__ import annotations

import json
import re
from io import BytesIO
from pathlib import Path
import sys

# Allow sibling imports within skill tools
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _patterns import BLANK_PAT


# ── Step 1+2: Extract text with location tags ─────────────────────────


def _merge_runs(paragraph) -> None:
    if not paragraph.runs:
        return
    full = "".join(r.text for r in paragraph.runs)
    paragraph.runs[0].text = full
    # Remove extra runs from XML entirely (not just empty text)
    # to avoid spacing artifacts with justified paragraphs
    for run in paragraph.runs[1:]:
        run._element.getparent().remove(run._element)


def _extract_table_segments(table, prefix: str, segments: list, seen_cells: set):
    """Extract segments from a table, handling merged cells and nested tables."""
    for ri, row in enumerate(table.rows):
        for ci, cell in enumerate(row.cells):
            cell_id = id(cell)
            if cell_id in seen_cells:
                continue
            seen_cells.add(cell_id)

            cell_has_text = False
            for pi, para in enumerate(cell.paragraphs):
                # Read text without modifying runs (preserve formatting)
                text = para.text
                if text.strip():
                    cell_has_text = True
                    loc = f"{prefix}r{ri}c{ci}p{pi}"
                    segments.append({"location": loc, "text": text, "para_ref": para})

            # Include empty cells
            if not cell_has_text and cell.paragraphs:
                para = cell.paragraphs[0]
                loc = f"{prefix}r{ri}c{ci}p0"
                segments.append({"location": loc, "text": "", "para_ref": para})

            for nti, nested_table in enumerate(cell.tables):
                nested_prefix = f"{prefix}r{ri}c{ci}nt{nti}"
                _extract_table_segments(nested_table, nested_prefix, segments, seen_cells)


def _extract_segments(doc) -> list[dict]:
    """Extract all text segments with location IDs.

    NOTE: Does NOT modify runs/formatting — only reads para.text.
    _merge_runs is called later only on paragraphs that need text replacement.
    """
    segments = []

    for i, para in enumerate(doc.paragraphs):
        text = para.text
        if text.strip():
            segments.append({"location": f"p{i}", "text": text, "para_ref": para})

    for ti, table in enumerate(doc.tables):
        table_seen: set = set()
        _extract_table_segments(table, f"t{ti}", segments, table_seen)

    for si, section in enumerate(doc.sections):
        for part_name, part in [("header", section.header), ("footer", section.footer)]:
            if not part or (not part.is_linked_to_previous and si > 0):
                continue
            for pi, para in enumerate(part.paragraphs):
                text = para.text
                if text.strip():
                    loc = f"s{si}{part_name[0]}{pi}"
                    segments.append({"location": loc, "text": text, "para_ref": para})
            for hti, htable in enumerate(part.tables):
                hdr_seen: set = set()
                _extract_table_segments(htable, f"s{si}{part_name[0]}t{hti}", segments, hdr_seen)

    return segments


# ── Step 3: Detect fillable fields (code-based) ─────────────────────

# Patterns for fillable content
_PLACEHOLDER_PAT = re.compile(r'\[([\w\s\u00C0-\u024F]{2,})\]')  # [CÔNG TY], [NĂM]
_EMPTY_BRACKET_PAT = re.compile(r'\[\s*\]')                        # [] or [ ] — empty brackets
_DATE_PAT = re.compile(r'dd/mm/yyyy\d*')                          # dd/mm/yyyy1
_BLANK_PAT_DETECT = re.compile(
    r'…[\s(]'            # single … followed by space or paren
    r'|[.…]{3,}'         # 3+ dots/ellipsis
    r'|_{3,}'            # 3+ underscores
    r'|-{3,}'            # 3+ dashes
    r'|\{\{[\w\s]+\}\}'  # {{field}}
    r'|[☐☑]'             # checkboxes
    r'|\[\s*\]'           # [] empty brackets
    r'|\[\*\]'            # [*] checkbox-style
    , re.UNICODE
)


def _find_table_row_label(segments: list[dict], loc: str) -> str:
    """Find label for a table cell by looking at column 0 of the same row."""
    m = re.match(r'((?:s\d+[hf])?t\d+r\d+)', loc)
    if not m:
        return ""
    row_prefix = m.group(1)

    # Find c0 in same row
    for seg in segments:
        sloc = seg["location"]
        if sloc.startswith(row_prefix) and "c0p" in sloc and seg["text"]:
            return seg["text"].strip()[:50]

    return ""


def _find_table_section(segments: list[dict], loc: str) -> str:
    """Find section header for a table cell (e.g. '(1) CÔNG TY DDD' or '(2) Khách Hàng').

    Walks backwards from current row to find header-like rows.
    """
    m = re.match(r'((?:s\d+[hf])?t\d+)r(\d+)', loc)
    if not m:
        return ""
    table_prefix = m.group(1)
    current_row = int(m.group(2))

    # Walk backwards to find header row
    for ri in range(current_row - 1, -1, -1):
        row_prefix = f"{table_prefix}r{ri}"
        for seg in segments:
            sloc = seg["location"]
            if sloc.startswith(row_prefix) and "c0p" in sloc:
                text = seg["text"].strip()
                # Header patterns: "(1) ...", "(2) ...", "VÀ", merged row headers
                if re.match(r'^\(\d+\)', text) or text in ("VÀ",):
                    return text[:60]
                # Stop if we hit a label row (Địa chỉ, Chức vụ, etc.)
                if len(text) < 30 and not text.endswith(':'):
                    continue
                break

    return ""


def _find_table_role(segments: list[dict], loc: str) -> str:
    """Find role/category label for a table cell from column 0 of nearby rows.

    For tables like:
      c0: "Phụ Trách Chính"  |  c1: DDD  |  c2: Khách Hàng
    Returns "Phụ Trách Chính" for cells in that row.

    Also checks the header row (row 0) for column context (e.g. "Khách Hàng" in c2).
    """
    m = re.match(r'((?:s\d+[hf])?t\d+)r(\d+)c(\d+)', loc)
    if not m:
        return ""
    table_prefix = m.group(1)
    current_row = int(m.group(2))
    current_col = int(m.group(3))

    parts = []

    # Get row label from c0
    row_label = _find_table_row_label(segments, loc)
    if row_label:
        parts.append(row_label)

    # Get column header from row 0, same column
    header_loc_prefix = f"{table_prefix}r0c{current_col}"
    for seg in segments:
        if seg["location"].startswith(header_loc_prefix) and seg["text"]:
            parts.append(seg["text"].strip()[:30])
            break

    return " — ".join(parts)


def _detect_fields(segments: list[dict]) -> list[dict]:
    """Detect all fillable fields from segments using regex + heuristics.

    Returns list of field dicts: {id, location, label, current, type, position?}
    """
    fields = []
    idx = 0

    for seg in segments:
        text = seg["text"]
        loc = seg["location"]
        is_table = re.match(r'(?:s\d+[hf])?t\d+', loc) is not None

        # ── Type: empty cell ──
        if not text and is_table:
            row_label = _find_table_row_label(segments, loc)
            # Skip empty cells in section header rows (e.g. "(1) CÔNG TY ABC")
            if re.match(r'^\(\d+\)', row_label.strip()):
                continue
            section = _find_table_section(segments, loc)
            label = row_label
            if section:
                label = f"{row_label} — {section}" if row_label else section
            if not label:
                # Try role-based label
                label = _find_table_role(segments, loc)
            if not label:
                label = f"Ô trống tại {loc}"
            fields.append({
                "id": f"f{idx}", "location": loc, "label": label,
                "current": "(trống)", "type": "empty",
            })
            idx += 1
            continue

        if not text:
            continue

        # ── Skip: cells that only contain ":" (separator, not a field) ──
        if is_table and text.strip() == ':':
            continue

        # ── Type: [PLACEHOLDER] ──
        for m in _PLACEHOLDER_PAT.finditer(text):
            label = m.group(1).strip()
            if is_table:
                section = _find_table_section(segments, loc)
                if section:
                    label = f"{label} — {section}"
            fields.append({
                "id": f"f{idx}", "location": loc, "label": label,
                "current": m.group(), "type": "placeholder", "position": m.start(),
            })
            idx += 1

        # ── Type: date placeholder (dd/mm/yyyy) ──
        for m in _DATE_PAT.finditer(text):
            before = text[:m.start()].strip()
            context_words = before.split()[-4:]
            label = " ".join(context_words) if context_words else "Ngày"
            fields.append({
                "id": f"f{idx}", "location": loc, "label": label,
                "current": m.group(), "type": "date", "position": m.start(),
            })
            idx += 1

        # ── Type: blank patterns (___, ……, ---) ──
        for m in _BLANK_PAT_DETECT.finditer(text):
            # Skip if position already covered by placeholder or date
            if any(f["location"] == loc and f.get("position") == m.start() for f in fields):
                continue
            before = text[:m.start()].strip()
            label = ""
            colon_idx = before.rfind(':')
            if colon_idx >= 0:
                label_region = before[colon_idx + 1:].strip()
                if not label_region:
                    pre = before[:colon_idx]
                    for sep in ['.', ',', ';']:
                        last_sep = pre.rfind(sep)
                        if last_sep >= 0:
                            pre = pre[last_sep + 1:]
                            break
                    label = pre.strip()[-50:]
            if not label:
                words = before.split()
                label = " ".join(words[-3:]) if words else ""
            if not label and is_table:
                label = _find_table_row_label(segments, loc)
            if not label:
                # Try section context
                section = _find_table_section(segments, loc) if is_table else ""
                label = section if section else f"Field tại {loc}"
            fields.append({
                "id": f"f{idx}", "location": loc, "label": label,
                "current": m.group()[:30], "type": "blank", "position": m.start(),
            })
            idx += 1

        # ── Type: "Label: " with empty value ──
        # Only for SHORT text (table cells, short labels) — skip long paragraphs
        stripped = text.strip()
        if len(stripped) > 100:
            continue  # Long paragraphs ending with ":" are clauses, not fields

        has_empty_after_colon = False
        if stripped.endswith(':') or stripped.endswith(': '):
            has_empty_after_colon = True
        elif ':' in stripped:
            after_last = stripped.rsplit(':', 1)[-1].strip()
            if len(after_last) < 2:
                has_empty_after_colon = True

        if has_empty_after_colon:
            # Only if no other field types already detected for this location
            # AND (for table cells) no value field already detected in the same row
            already_has_field = any(f["location"] == loc for f in fields)
            row_has_value_field = False
            if is_table and not already_has_field:
                m_row = re.match(r'((?:s\d+[hf])?t\d+r\d+)', loc)
                if m_row:
                    row_prefix = m_row.group(1)
                    row_has_value_field = any(
                        f["location"].startswith(row_prefix) and f["location"] != loc
                        for f in fields
                    )
            if not already_has_field and not row_has_value_field:
                label = stripped.rstrip(': ').strip()
                if is_table:
                    # Add role context (e.g. "Phụ Trách Chính — Khách Hàng")
                    role = _find_table_role(segments, loc)
                    if role and role != label:
                        label = f"{label} — {role}"
                    elif not role:
                        section = _find_table_section(segments, loc)
                        if section:
                            label = f"{label} — {section}"
                fields.append({
                    "id": f"f{idx}", "location": loc, "label": label,
                    "current": text, "type": "label_empty",
                })
                idx += 1

    return fields


# ── Step 4: LLM fills values ────────────────────────────────────────

FILL_PROMPT = """Bạn nhận danh sách các trường cần điền và thông tin user cung cấp.
Hãy điền value cho các trường mà user ĐÃ cung cấp thông tin phù hợp.

Trả về JSON object: {"values": {"f0": "giá trị", "f1": "giá trị", ...}}
Chỉ bao gồm fields mà user ĐÃ cung cấp thông tin. Bỏ qua fields không có thông tin.

Rules:
- KHÔNG tự bịa dữ liệu — chỉ điền thông tin user ĐÃ cung cấp
- Giữ đúng tiếng Việt có dấu (nếu user viết không dấu → chuyển có dấu)
- Phân biệt rõ thông tin thuộc bên nào (vd: "Địa chỉ — (1) DDD" ≠ "Địa chỉ — (2) Khách Hàng")
- Với field loại "label_empty" (vd: current="Bà: "): trả value = "Bà: Nguyễn Thị X" (giữ nguyên label)
- Với field loại "placeholder" (vd: current="[CÔNG TY]"): trả value = "CÔNG TY ABC"
- Với field loại "empty" (trống): trả value = giá trị cần điền
- Với field loại "blank" (vd: current="____"): trả value thay thế cho blank
- Với field loại "date" (vd: current="dd/mm/yyyy1"): trả value = "15/04/2026"
- Trả về JSON {"values": {...}}, không có text khác"""


UPDATE_PROMPT = """Bạn nhận danh sách fields đã điền và yêu cầu sửa từ user.

Trả về JSON object: {"values": {"f0": "giá trị mới", ...}}
CHỈ bao gồm fields mà user YÊU CẦU SỬA. Không thay đổi fields khác.

Rules:
- CHỉ sửa những gì user yêu cầu
- KHÔNG tự bịa dữ liệu
- Trả về JSON {"values": {...}}, không text khác"""


def _build_field_list_text(fields: list[dict]) -> str:
    """Build human-readable field list for LLM input."""
    lines = []
    for f in fields:
        label = f["label"]
        current = f["current"][:50]
        ftype = f["type"]
        lines.append(f'{f["id"]}: {label} (loại: {ftype}, hiện tại: "{current}")')
    return "\n".join(lines)


async def _llm_fill_values(fields: list[dict], user_info: str, ctx, mode: str = "fill") -> dict:
    """LLM call: field list + user_info → filled values dict."""
    prompt = UPDATE_PROMPT if mode == "update" else FILL_PROMPT
    field_text = _build_field_list_text(fields)
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": f"Fields cần điền:\n{field_text}\n\nThông tin:\n{user_info}"},
    ]
    result = await ctx.llm_call(messages, response_format={"type": "json_object"})
    try:
        data = json.loads(result)
        return data.get("values", data) if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


# ── Step 5: Apply values back to docx ────────────────────────────────


def _apply_values(segments: list[dict], fields: list[dict], values: dict) -> tuple[int, list[str]]:
    """Apply LLM-filled values back to docx paragraphs.

    Returns (applied_count, unfilled_field_labels).
    """
    loc_map = {s["location"]: s["para_ref"] for s in segments}
    applied = 0
    unfilled = []

    for field in fields:
        fid = field["id"]
        value = values.get(fid)
        if not value:
            unfilled.append(field["label"])
            continue

        value = str(value)
        para = loc_map.get(field["location"])
        if not para:
            unfilled.append(field["label"])
            continue

        _merge_runs(para)
        text = para.runs[0].text if para.runs else ""
        ftype = field["type"]

        if ftype == "empty":
            # Empty cell → set value directly
            if para.runs:
                para.runs[0].text = value
            applied += 1

        elif ftype == "placeholder":
            # Replace [PLACEHOLDER] with value
            current = field["current"]
            if current in text:
                para.runs[0].text = text.replace(current, value, 1)
                applied += 1

        elif ftype == "date":
            # Replace dd/mm/yyyy with value
            current = field["current"]
            if current in text:
                para.runs[0].text = text.replace(current, value, 1)
                applied += 1

        elif ftype == "blank":
            # Replace blank pattern at position
            position = field.get("position", 0)
            blanks = list(_BLANK_PAT_DETECT.finditer(text))
            if blanks:
                best = min(blanks, key=lambda b: abs(b.start() - position))
                para.runs[0].text = text[:best.start()] + value + text[best.end():]
                applied += 1

        elif ftype == "label_empty":
            # "Bà: " → "Bà: Trần Thị Bình" (LLM returns full text including label)
            current = field["current"]
            if current.strip() in text:
                para.runs[0].text = text.replace(current.strip(), value.strip(), 1)
                applied += 1
            elif not text.strip():
                # Cell was actually empty
                if para.runs:
                    para.runs[0].text = value
                applied += 1

    return applied, unfilled


# ── Main entry ─────────────────────────────────────────────────────────


def _iter_all_paras(doc):
    """Iterate ALL paragraphs in a DOCX: body, tables (nested), headers, footers."""
    for para in doc.paragraphs:
        yield para
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    yield para
                for nested_table in cell.tables:
                    for nr in nested_table.rows:
                        for nc in nr.cells:
                            for para in nc.paragraphs:
                                yield para
    for section in doc.sections:
        for part in [section.header, section.footer]:
            if not part:
                continue
            for para in part.paragraphs:
                yield para


def _template_fill(doc, template_fields: list[dict], user_info: str, values: dict) -> tuple[int, list[str]]:
    """Fill a template DOCX by replacing ALL occurrences of {placeholder} tokens."""
    unfilled = []

    # Build token → value map
    token_map: dict[str, str] = {}
    for field in template_fields:
        value = values.get(field["id"])
        if not value:
            unfilled.append(field["label"])
            continue
        token_map["{" + field["placeholder"] + "}"] = str(value)

    if not token_map:
        return 0, unfilled

    # Replace all occurrences in every paragraph across entire document
    replaced_count = 0
    for para in _iter_all_paras(doc):
        text = para.text
        if "{" not in text:
            continue
        new_text = text
        for token, value in token_map.items():
            while token in new_text:
                new_text = new_text.replace(token, value, 1)
                replaced_count += 1
        if new_text != text:
            _merge_runs(para)
            if para.runs:
                para.runs[0].text = new_text

    return replaced_count, unfilled


async def run(args: dict, ctx) -> dict:
    """Docx fill pipeline: code detect + LLM fill."""
    from docx import Document

    document_id: str = args["document_id"]
    user_info: str = args.get("user_info", "")
    mode: str = args.get("mode", "fill")
    template_id: str | None = args.get("template_id")

    # Retrieve previous state for update mode
    state: dict = args.get("_state", {})

    if not user_info:
        return {"error": "Cần cung cấp thông tin để điền (user_info)", "rendered_document_id": None}

    # ── Template-based path (when template_id provided) ──
    if template_id:
        return await _run_with_template(args, ctx, template_id, document_id, user_info, mode)

    # ── Original path (no template) ──
    # Step 1: Load docx
    doc_bytes = await ctx.get_document_bytes(document_id)
    doc = Document(BytesIO(doc_bytes))

    # Step 2: Extract all segments
    segments = _extract_segments(doc)

    # Step 3: Detect fillable fields (code-based, deterministic)
    fields = _detect_fields(segments)

    if not fields:
        return {"error": "Không tìm thấy trường nào cần điền trong template.", "rendered_document_id": None}

    # Step 4: LLM fills values (1 call, small input)
    values = await _llm_fill_values(fields, user_info, ctx, mode=mode)

    if not values:
        return {
            "error": "LLM không điền được giá trị. Thử cung cấp thông tin rõ ràng hơn.",
            "rendered_document_id": None,
            "total_fields": len(fields),
        }

    # Step 5: Apply values to docx
    applied_count, unfilled = _apply_values(segments, fields, values)

    # Step 6: Save rendered + PDF
    output = BytesIO()
    doc.save(output)
    rendered_bytes = output.getvalue()

    rendered_id = await ctx.save_rendered_document(rendered_bytes, document_id)

    preview_pdf_id = None
    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    pdf_bytes = await ctx.convert_to_pdf(rendered_bytes, mime)
    if pdf_bytes:
        preview_pdf_id = await ctx.save_pdf_preview(pdf_bytes, document_id)

    return {
        "rendered_document_id": str(rendered_id),
        "preview_pdf_id": str(preview_pdf_id) if preview_pdf_id else None,
        "applied_count": applied_count,
        "filled_count": len(values),
        "total_fields": len(fields),
        "unfilled_fields": unfilled[:20],
        "_state": {"filled_values": values},
    }


async def _run_with_template(args: dict, ctx, template_id: str, document_id: str, user_info: str, mode: str) -> dict:
    """Fill using a pre-extracted template with {placeholder} tokens.

    Cross-turn: merges new values with previous values from _state,
    then fills ALL values into a fresh template copy every time.
    """
    from docx import Document

    # Load template document metadata to get field list
    from sqlalchemy import text as sa_text
    result = await ctx.db.execute(
        sa_text("SELECT source_metadata FROM documents_document WHERE id = :tid"),
        {"tid": template_id},
    )
    row = result.fetchone()
    if not row or not row[0]:
        return {"error": f"Template {template_id} not found or has no fields", "rendered_document_id": None}

    meta = row[0]
    template_fields = meta.get("template_fields", [])
    if not template_fields:
        return {"error": "Template has no fields defined", "rendered_document_id": None}

    # Restore previous values from cross-turn state
    state: dict = args.get("_state", {})
    previous_values: dict = state.get("filled_values", {})

    # Load template DOCX (always from template — has all {placeholders})
    template_bytes = await ctx.get_document_bytes(template_id)
    doc = Document(BytesIO(template_bytes))

    # Build field list for LLM — combine placeholder name + original label
    fields_for_llm = []
    for f in template_fields:
        placeholder = f["placeholder"]
        label = f.get("label", "")
        readable = placeholder.replace("_", " ")
        if label and label.lower().replace(" ", "_") != placeholder.lower():
            combined = f"{readable} ({label})"
        else:
            combined = readable

        # Show previously filled value so LLM knows what's already done
        prev = previous_values.get(f["id"])
        current = prev if prev else "{" + placeholder + "}"

        fields_for_llm.append({
            "id": f["id"],
            "label": combined,
            "current": str(current),
            "type": "placeholder",
        })

    # LLM fills values (only for fields user provided info for)
    new_values = await _llm_fill_values(fields_for_llm, user_info, ctx, mode=mode)

    # Merge: previous values + new values (new overrides old)
    merged_values = {**previous_values, **new_values}

    if not merged_values:
        return {
            "error": "LLM không điền được giá trị.",
            "rendered_document_id": None,
            "total_fields": len(template_fields),
        }

    # Apply ALL merged values to fresh template
    applied_count, unfilled = _template_fill(doc, template_fields, user_info, merged_values)

    # Save rendered + PDF
    output = BytesIO()
    doc.save(output)
    rendered_bytes = output.getvalue()

    # Save using source document_id (original file) as reference
    rendered_id = await ctx.save_rendered_document(rendered_bytes, document_id)

    preview_pdf_id = None
    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    pdf_bytes = await ctx.convert_to_pdf(rendered_bytes, mime)
    if pdf_bytes:
        preview_pdf_id = await ctx.save_pdf_preview(pdf_bytes, document_id)

    return {
        "rendered_document_id": str(rendered_id),
        "preview_pdf_id": str(preview_pdf_id) if preview_pdf_id else None,
        "applied_count": applied_count,
        "filled_count": len(merged_values),
        "total_fields": len(template_fields),
        "unfilled_fields": unfilled[:20],
        "used_template": template_id,
        "_state": {"filled_values": merged_values},
    }
