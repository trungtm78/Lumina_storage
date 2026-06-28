"""Bóc tách Excel theo cột — OPS use case.

OPS nhận file Excel từ Sales chứa sản phẩm của nhiều NCC, cần tách thành N file
mỗi NCC một file để gửi đi xử lý đơn hàng. Service này thuần CPU + bytes
(không I/O storage), giữ nguyên header row + định dạng cell cơ bản.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass
from typing import Any

from openpyxl import Workbook, load_workbook
from openpyxl.utils import get_column_letter


@dataclass
class ExcelMeta:
    columns: list[str]
    sample_rows: list[dict[str, Any]]
    total_rows: int
    sheet_name: str


# Filename safety — Windows + Unix forbidden characters.
_FORBIDDEN_FILENAME_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def safe_filename_segment(value: str, max_length: int = 80) -> str:
    """Convert an arbitrary string (NCC name) into a safe filename segment."""
    if value is None:
        cleaned = ""
    else:
        cleaned = _FORBIDDEN_FILENAME_RE.sub("_", str(value)).strip()
    cleaned = cleaned.strip(". ")  # trailing dots/spaces invalid on Windows
    if not cleaned:
        cleaned = "khong_xac_dinh"
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length].rstrip()
    return cleaned


def read_excel_meta(
    xlsx_bytes: bytes, sample_size: int = 5,
) -> ExcelMeta:
    """Read the first sheet's header row + first N data rows for UI preview."""
    wb = load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
    sheet_name = wb.sheetnames[0]
    ws = wb[sheet_name]

    rows_iter = ws.iter_rows(values_only=True)
    try:
        header = next(rows_iter)
    except StopIteration:
        wb.close()
        return ExcelMeta(columns=[], sample_rows=[], total_rows=0, sheet_name=sheet_name)

    columns = [
        str(c) if c is not None else f"Col{idx + 1}"
        for idx, c in enumerate(header)
    ]

    sample_rows: list[dict[str, Any]] = []
    total = 0
    for row in rows_iter:
        total += 1
        if len(sample_rows) < sample_size:
            sample_rows.append(
                {
                    columns[i]: (
                        row[i] if i < len(row) and row[i] is not None else ""
                    )
                    for i in range(len(columns))
                }
            )

    wb.close()
    return ExcelMeta(
        columns=columns,
        sample_rows=sample_rows,
        total_rows=total,
        sheet_name=sheet_name,
    )


def _make_workbook_with_header(header: list[str], sheet_name: str = "Sheet1") -> Workbook:
    out = Workbook()
    ws = out.active
    ws.title = sheet_name[:31] or "Sheet1"  # Excel sheet name max 31 chars
    ws.append(header)
    return ws.parent


def _autosize_columns(ws, header: list[str]) -> None:
    """Best-effort: set a reasonable column width based on max content length."""
    for col_idx, _ in enumerate(header, start=1):
        max_len = 0
        for cell in ws[get_column_letter(col_idx)]:
            v = cell.value
            if v is None:
                continue
            length = len(str(v))
            if length > max_len:
                max_len = length
        ws.column_dimensions[get_column_letter(col_idx)].width = min(
            max(10, max_len + 2), 60,
        )


def split_workbook_by_column(
    xlsx_bytes: bytes, group_column: str,
) -> dict[str, bytes]:
    """Group rows by `group_column` value and emit a separate xlsx per group.

    Returns a mapping `group_value (raw str) -> xlsx_bytes`. Rows where the
    grouping cell is empty/None are bucketed under the literal "(trống)".
    """
    wb = load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
    sheet_name = wb.sheetnames[0]
    ws = wb[sheet_name]

    rows_iter = ws.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        wb.close()
        raise ValueError("Excel rỗng — không có dòng header.")

    header = [
        str(c) if c is not None else f"Col{idx + 1}"
        for idx, c in enumerate(header_row)
    ]
    if group_column not in header:
        wb.close()
        raise ValueError(
            f"Cột '{group_column}' không tồn tại trong header. "
            f"Available: {', '.join(header)}"
        )

    group_idx = header.index(group_column)

    # Collect rows per group as native python tuples (preserves types).
    grouped: dict[str, list[tuple]] = {}
    for row in rows_iter:
        if all(cell is None for cell in row):
            continue  # skip blank rows
        raw = row[group_idx] if group_idx < len(row) else None
        key = str(raw).strip() if raw is not None and str(raw).strip() else "(trống)"
        grouped.setdefault(key, []).append(row)

    wb.close()

    out: dict[str, bytes] = {}
    for key, rows in grouped.items():
        wb_out = _make_workbook_with_header(header, sheet_name=sheet_name)
        ws_out = wb_out.active
        for r in rows:
            # Trim/pad row to header width to avoid misalignment.
            ws_out.append(list(r[: len(header)]) + [None] * max(0, len(header) - len(r)))
        _autosize_columns(ws_out, header)
        buf = io.BytesIO()
        wb_out.save(buf)
        out[key] = buf.getvalue()

    return out


def build_summary(
    xlsx_bytes: bytes, group_column: str,
) -> bytes:
    """Build a 2-column summary: group_value → row_count.

    Mỗi NCC một dòng với số sản phẩm tương ứng — file gửi DVVC tham chiếu nhanh.
    """
    wb = load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows_iter = ws.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        wb.close()
        raise ValueError("Excel rỗng.")
    header = [str(c) if c is not None else "" for c in header_row]
    if group_column not in header:
        wb.close()
        raise ValueError(f"Cột '{group_column}' không tồn tại.")
    idx = header.index(group_column)

    counts: dict[str, int] = {}
    for row in rows_iter:
        if all(cell is None for cell in row):
            continue
        raw = row[idx] if idx < len(row) else None
        key = str(raw).strip() if raw is not None and str(raw).strip() else "(trống)"
        counts[key] = counts.get(key, 0) + 1
    wb.close()

    wb_out = Workbook()
    ws_out = wb_out.active
    ws_out.title = "Tổng hợp"
    summary_header = [group_column, "Số dòng"]
    ws_out.append(summary_header)
    for k, n in sorted(counts.items()):
        ws_out.append([k, n])
    ws_out.append(["TỔNG", sum(counts.values())])
    _autosize_columns(ws_out, summary_header)
    buf = io.BytesIO()
    wb_out.save(buf)
    return buf.getvalue()


def build_zip(
    group_files: dict[str, bytes],
    summary_xlsx: bytes | None = None,
    summary_name: str = "00_TONG_HOP.xlsx",
    file_prefix: str = "",
) -> bytes:
    """Pack the per-group files (and optional summary) into a single ZIP."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        if summary_xlsx is not None:
            zf.writestr(summary_name, summary_xlsx)
        for key, payload in group_files.items():
            name = f"{file_prefix}{safe_filename_segment(key)}.xlsx"
            zf.writestr(name, payload)
    return buf.getvalue()
