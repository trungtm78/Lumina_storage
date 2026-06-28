"""Parse a .docx template — extract text, detect blank fields with IDs, list paragraphs.

Auto-called by read_document. Returns:
- full_text: all text (truncated for context)
- structure: human-readable summary
- fields: blank fields with unique IDs + paragraph index (for field_id edits)
- paragraphs: all paragraphs with IDs (for para_id edits)
"""

from __future__ import annotations

import re
from io import BytesIO
from pathlib import Path
import sys

# Allow sibling imports within skill tools
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _patterns import BLANK_PAT as _BLANK_RE


def _merge_runs(paragraph) -> None:
    if not paragraph.runs:
        return
    full_text = "".join(r.text for r in paragraph.runs)
    paragraph.runs[0].text = full_text
    for run in paragraph.runs[1:]:
        run.text = ""


def _extract_label(text: str, blank_start: int) -> str:
    """Extract label before a blank pattern (e.g. 'Ông:' from 'Ông: ………')."""
    before = text[:blank_start].rstrip()
    # Find last label-like segment (ends with : or is a known pattern)
    # Try to get the label portion
    colon_idx = before.rfind(":")
    if colon_idx >= 0:
        label = before[max(0, before.rfind("\n", 0, colon_idx) + 1):colon_idx].strip()
        if label:
            return label
    # Fallback: last few words
    words = before.split()
    return " ".join(words[-3:]) if words else ""


def _process_para(para, para_id: str, current_section: str,
                   fields: list, paragraphs: list, full_text_lines: list,
                   field_counter: int) -> tuple[str, int]:
    """Process a single paragraph: extract text, detect blanks, track sections.

    Returns updated (current_section, field_counter).
    """
    _merge_runs(para)
    text = para.text
    if not text.strip():
        return current_section, field_counter

    full_text_lines.append(text)
    paragraphs.append({"id": para_id, "text": text[:500]})

    # Track section context (bold/uppercase headers)
    stripped = text.strip()
    if (stripped.isupper() or stripped.startswith("BÊN ") or
        stripped.startswith("Điều ") or stripped.startswith("ĐIỀU ") or
        (len(stripped) < 60 and stripped.endswith(":"))):
        current_section = stripped.rstrip(":").strip()[:40]

    # Detect blank fields
    for match in _BLANK_RE.finditer(text):
        blank_text = match.group()
        raw_label = _extract_label(text, match.start())
        if current_section and raw_label:
            label = f"{raw_label} ({current_section})"
        elif current_section:
            label = f"({current_section})"
        else:
            label = raw_label
        field_id = f"f{field_counter}"
        field_counter += 1

        fields.append({
            "id": field_id,
            "label": label,
            "para_id": para_id,
            "blank": blank_text[:50],
            "position": match.start(),
        })

    return current_section, field_counter


def _process_table(table, prefix: str, current_section: str,
                   fields: list, paragraphs: list, full_text_lines: list,
                   field_counter: int, seen_cells: set) -> tuple[str, int]:
    """Process a table recursively (handles merged cells + nested tables)."""
    for ri, row in enumerate(table.rows):
        for ci, cell in enumerate(row.cells):
            cell_id = id(cell)
            if cell_id in seen_cells:
                continue
            seen_cells.add(cell_id)

            for pi, para in enumerate(cell.paragraphs):
                para_id = f"{prefix}r{ri}c{ci}p{pi}"
                current_section, field_counter = _process_para(
                    para, para_id, current_section,
                    fields, paragraphs, full_text_lines, field_counter,
                )

            # Recurse into nested tables
            for nti, nested_table in enumerate(cell.tables):
                nested_prefix = f"{prefix}r{ri}c{ci}nt{nti}"
                current_section, field_counter = _process_table(
                    nested_table, nested_prefix, current_section,
                    fields, paragraphs, full_text_lines, field_counter, seen_cells,
                )

    return current_section, field_counter


async def run(args: dict, ctx) -> dict:
    """Parse document — return fields (with IDs) + paragraphs (with IDs).

    Covers: body paragraphs, tables (merged cells + nested), headers/footers.
    """
    from docx import Document

    doc_bytes = await ctx.get_document_bytes(args["document_id"])
    doc = Document(BytesIO(doc_bytes))

    fields: list[dict] = []
    paragraphs: list[dict] = []
    full_text_lines: list[str] = []
    field_counter = 0
    current_section = ""

    # ── Body paragraphs ──
    for para_idx, para in enumerate(doc.paragraphs):
        para_id = f"p{para_idx}"
        current_section, field_counter = _process_para(
            para, para_id, current_section,
            fields, paragraphs, full_text_lines, field_counter,
        )

    # ── Tables (with merged cell dedup + nested table support) ──
    seen_cells: set = set()
    for table_idx, table in enumerate(doc.tables):
        current_section, field_counter = _process_table(
            table, f"t{table_idx}", current_section,
            fields, paragraphs, full_text_lines, field_counter, seen_cells,
        )

    # ── Headers & Footers ──
    for si, section in enumerate(doc.sections):
        for part_name, part in [("header", section.header), ("footer", section.footer)]:
            if not part or not part.is_linked_to_previous and si > 0:
                continue
            for pi, para in enumerate(part.paragraphs):
                para_id = f"s{si}{part_name[0]}{pi}"
                current_section, field_counter = _process_para(
                    para, para_id, current_section,
                    fields, paragraphs, full_text_lines, field_counter,
                )
            for hti, htable in enumerate(part.tables):
                current_section, field_counter = _process_table(
                    htable, f"s{si}{part_name[0]}t{hti}", current_section,
                    fields, paragraphs, full_text_lines, field_counter, seen_cells,
                )

    full_text = "\n".join(full_text_lines)

    # Build structure summary
    if fields:
        structure_lines = [f"Phát hiện {len(fields)} trường cần điền:"]
        for f in fields:
            structure_lines.append(f"  - [{f['id']}] {f['label']}: {f['blank'][:20]}")
        structure = "\n".join(structure_lines)
    else:
        structure = "Không phát hiện trường trống. User có thể yêu cầu sửa text bất kỳ bằng para_id."

    return {
        "full_text": full_text[:8000],
        "structure": structure,
        "fields": fields,
        "paragraphs": paragraphs,
    }
