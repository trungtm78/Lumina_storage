"""Render a .xlsx template by filling in field values.

Works with any fill pattern: {{field}}, ……………, ___________, empty cells after labels.
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


def _slug(text: str) -> str:
    return re.sub(r'\W+', '_', text.lower()).strip('_')


async def run(args: dict, ctx) -> dict:
    """Fill field_values into xlsx template and save as new document."""
    import openpyxl

    document_id: str = args["document_id"]
    if "field_values" in args:
        raw_values: dict = args["field_values"]
    else:
        raw_values = {k: v for k, v in args.items() if k != "document_id"}

    # Build slug → value AND original_label → value for matching
    field_values: dict[str, str] = {}
    for k, v in raw_values.items():
        field_values[_slug(k)] = str(v)
        field_values[k.lower()] = str(v)

    doc_bytes = await ctx.get_document_bytes(document_id)
    wb = openpyxl.load_workbook(BytesIO(doc_bytes))

    for sheet in wb.worksheets:
        rows = list(sheet.iter_rows())
        for row_idx, row in enumerate(rows):
            for col_idx, cell in enumerate(row):
                if cell.value is None:
                    continue
                cell_text = str(cell.value)
                cell_slug = _slug(cell_text)

                # Case 1: cell itself contains fill pattern (e.g. "……" or "{{field}}")
                new_text, count = _FILL_RE.subn("", cell_text)
                if count > 0:
                    # This cell IS a fill cell — check if previous cell in row is a label
                    if col_idx > 0:
                        prev_cell = row[col_idx - 1]
                        if prev_cell.value:
                            label_slug = _slug(str(prev_cell.value).rstrip(':：'))
                            if label_slug in field_values:
                                cell.value = field_values[label_slug]
                                continue
                    # Check if cell above is a label
                    if row_idx > 0:
                        above_cell = rows[row_idx - 1][col_idx]
                        if above_cell.value:
                            label_slug = _slug(str(above_cell.value).rstrip(':：'))
                            if label_slug in field_values:
                                cell.value = field_values[label_slug]
                                continue

                # Case 2: cell contains "Label: ……" pattern
                colon_match = re.match(r'^([^:：]+[:：])\s*([.…_]{3,}.*)$', cell_text)
                if colon_match:
                    label_part = colon_match.group(1).rstrip(':：').strip()
                    label_slug = _slug(label_part)
                    if label_slug in field_values:
                        cell.value = f"{label_part}: {field_values[label_slug]}"
                        continue

                # Case 3: cell text directly matches a field name
                if cell_slug in field_values:
                    # This could be a label cell — check if next cell is empty
                    if col_idx + 1 < len(row) and row[col_idx + 1].value is None:
                        row[col_idx + 1].value = field_values[cell_slug]

    output = BytesIO()
    wb.save(output)
    output_bytes = output.getvalue()

    rendered_id = await ctx.save_rendered_document(
        data=output_bytes,
        source_document_id=document_id,
        filename_suffix="_filled",
    )

    return {
        "rendered_document_id": str(rendered_id),
        "status": "success",
    }
