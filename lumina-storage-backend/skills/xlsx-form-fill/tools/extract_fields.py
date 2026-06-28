"""Extract fillable fields from a .xlsx template.

Supports: {{field}}, ……………, ___________, empty cells after labels.
Returns raw text so the LLM can understand the structure.
"""

from __future__ import annotations

import re
from io import BytesIO


_FILL_RE = re.compile(
    r'(\{{2}\w+\}{2})'
    r'|([.…]{3,})'
    r'|(_{3,})',
    re.UNICODE,
)

_LABEL_FIELD_RE = re.compile(
    r'^([^:：]+[:：])\s*(?:[.…_]{3,}|$)',
    re.UNICODE | re.MULTILINE,
)


async def run(args: dict, ctx) -> dict:
    """Return spreadsheet text + detected fillable fields."""
    import openpyxl

    doc_bytes = await ctx.get_document_bytes(args["document_id"])
    wb = openpyxl.load_workbook(BytesIO(doc_bytes))

    lines = []
    for sheet in wb.worksheets:
        lines.append(f"[Sheet: {sheet.title}]")
        for row in sheet.iter_rows():
            row_texts = []
            for cell in row:
                if cell.value is not None:
                    row_texts.append(str(cell.value))
            if row_texts:
                lines.append(" | ".join(row_texts))

    full_text = "\n".join(lines)
    fields = []
    seen: set[str] = set()
    for match in _LABEL_FIELD_RE.finditer(full_text):
        label_raw = match.group(1).rstrip(":：").strip()
        slug = re.sub(r'\W+', '_', label_raw.lower().strip()).strip('_')
        if not slug or slug in seen:
            continue
        seen.add(slug)
        fields.append({"name": slug, "label": label_raw})

    return {
        "document_text": full_text[:3000],
        "detected_fields": fields,
        "note": (
            "Use document_text to understand the spreadsheet structure. "
            "Ask the user for each field value one at a time."
        ),
    }
