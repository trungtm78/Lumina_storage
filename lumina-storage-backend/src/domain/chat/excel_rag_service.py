"""
Excel RAG parser — portable module for lumina-driver.

Pipeline:
    file_bytes → load_workbook (magic byte detection + openpyxl/pandas/calamine fallback)
               → per sheet: border detection → header start row
                            merged cell propagation → multi-level column names
                            bold detection → parent/child row hierarchy
               → per row: key-value text chunk  "[SheetName]\\n- Col: Val\\n- Col2: Val2"
               → PageResult (1 per sheet, page_number = sheet index)

Inspired by RAGFlow's deepdoc/parser/excel_parser.py and rag/app/table.py.
"""

import logging
import re
from io import BytesIO
from typing import Any

from src.services.text_extraction_service import PageResult

logger = logging.getLogger(__name__)

_ILLEGAL_CHARS_RE = re.compile(r"[\000-\010]|\013|\014|[\016-\037]")


# ---------------------------------------------------------------------------
# Workbook loading — magic byte detection + fallback chain
# ---------------------------------------------------------------------------

def _load_workbook(file_bytes: bytes):
    """Load bytes into an openpyxl Workbook using magic byte detection and fallbacks."""
    import pandas as pd
    from openpyxl import load_workbook

    bio = BytesIO(file_bytes)

    # Detect file type by magic bytes
    bio.seek(0)
    magic = bio.read(4)
    bio.seek(0)

    is_excel = magic.startswith(b"PK\x03\x04") or magic.startswith(b"\xd0\xcf\x11\xe0")

    if not is_excel:
        # Treat as CSV
        logger.info("excel_rag: magic bytes not Excel, parsing as CSV")
        try:
            df = pd.read_csv(bio, on_bad_lines="skip")
            return _dataframe_to_workbook(df)
        except Exception as e:
            raise ValueError(f"Failed to parse as CSV: {e}") from e

    # Try openpyxl first (best for merged cells, formatting)
    try:
        return load_workbook(bio, data_only=True)
    except Exception as e_openpyxl:
        logger.info("excel_rag: openpyxl failed (%s), trying pandas", e_openpyxl)

    # Fallback: pandas default engine
    try:
        bio.seek(0)
        dfs = pd.read_excel(bio, sheet_name=None)
        return _dataframe_to_workbook(dfs)
    except Exception:
        pass

    # Fallback: calamine engine
    try:
        bio.seek(0)
        df = pd.read_excel(bio, engine="calamine")
        return _dataframe_to_workbook(df)
    except Exception as e_calamine:
        raise ValueError(f"All Excel parsers failed. Last error: {e_calamine}") from e_calamine


def _dataframe_to_workbook(df_or_dict):
    """Convert pandas DataFrame (or dict of DataFrames) to openpyxl Workbook."""
    import pandas as pd
    from openpyxl import Workbook

    def _clean(df: "pd.DataFrame") -> "pd.DataFrame":
        def _clean_str(s):
            if isinstance(s, str):
                return _ILLEGAL_CHARS_RE.sub(" ", s)
            return s
        return df.apply(lambda col: col.map(_clean_str))

    def _fill_ws(ws, df: "pd.DataFrame") -> None:
        for col_num, col_name in enumerate(df.columns, 1):
            ws.cell(row=1, column=col_num, value=col_name)
        for row_num, row in enumerate(df.values, 2):
            for col_num, val in enumerate(row, 1):
                ws.cell(row=row_num, column=col_num, value=val)

    wb = Workbook()

    if isinstance(df_or_dict, dict) and len(df_or_dict) > 1:
        default = wb.active
        wb.remove(default)
        for sheet_name, df in df_or_dict.items():
            ws = wb.create_sheet(title=str(sheet_name))
            _fill_ws(ws, _clean(df))
    else:
        df = list(df_or_dict.values())[0] if isinstance(df_or_dict, dict) else df_or_dict
        ws = wb.active
        ws.title = "Data"
        _fill_ws(ws, _clean(df))

    return wb


# ---------------------------------------------------------------------------
# Row count — binary search to skip phantom empty rows (RAGFlow approach)
# ---------------------------------------------------------------------------

def _get_actual_row_count(ws) -> int:
    max_row = ws.max_row or 0
    if max_row == 0:
        return 0
    if max_row <= 10_000:
        return max_row

    max_col = min(ws.max_column or 1, 50)

    def row_has_data(r: int) -> bool:
        return any(
            ws.cell(r, c).value is not None and str(ws.cell(r, c).value).strip()
            for c in range(1, max_col + 1)
        )

    if not any(row_has_data(i) for i in range(1, min(101, max_row + 1))):
        return 0

    left, right, last = 1, max_row, 1
    while left <= right:
        mid = (left + right) // 2
        found = False
        for r in range(mid, min(mid + 10, max_row + 1)):
            if row_has_data(r):
                found = True
                last = max(last, r)
                break
        if found:
            left = mid + 1
        else:
            right = mid - 1

    for r in range(last, min(last + 500, max_row + 1)):
        if row_has_data(r):
            last = r

    return last


# ---------------------------------------------------------------------------
# Border / bold helpers
# ---------------------------------------------------------------------------

def _cell_has_border(cell) -> bool:
    try:
        b = cell.border
        return any(
            getattr(side, "style", None) is not None
            for side in (b.top, b.bottom, b.left, b.right)
        )
    except Exception:
        return False


def _cell_is_bold(cell) -> bool:
    try:
        return bool(cell.font and cell.font.bold)
    except Exception:
        return False


def _find_header_start_by_border(ws, n_cols: int, max_check: int = 30, min_bordered: int = 3) -> int:
    """Return the 1-based row number where the bordered table header starts.

    Scans the first `max_check` rows; returns the first row where at least
    `min_bordered` cells (checking up to the first 14 columns) have a border.
    Falls back to row 1 if nothing is found.
    """
    check_cols = min(n_cols, 14)
    for row_num in range(1, max_check + 1):
        bordered = sum(
            1 for c in range(1, check_cols + 1) if _cell_has_border(ws.cell(row_num, c))
        )
        if bordered >= min_bordered:
            return row_num
    return 1


# ---------------------------------------------------------------------------
# Merged cell value lookup
# ---------------------------------------------------------------------------

def _get_merged_value(ws, row: int, col: int, merged_ranges) -> Any:
    """Return the anchor-cell value if (row, col) falls inside a merged range."""
    for rng in merged_ranges:
        if rng.min_row <= row <= rng.max_row and rng.min_col <= col <= rng.max_col:
            return ws.cell(rng.min_row, rng.min_col).value
    return None


# ---------------------------------------------------------------------------
# fill_row_nearest — interpolate None values between non-None values
# ---------------------------------------------------------------------------

def _fill_row_nearest(values: list) -> list:
    """Fill None gaps by nearest neighbour — only BETWEEN existing values, no edge extrapolation."""
    result = list(values)
    non_none = [i for i, v in enumerate(result) if v is not None]
    if not non_none:
        return result
    first, last = non_none[0], non_none[-1]
    for i in range(first, last + 1):
        if result[i] is not None:
            continue
        left = max((p for p in non_none if p < i), default=None)
        right = min((p for p in non_none if p > i), default=None)
        if left is not None and right is not None:
            result[i] = result[left] if (i - left) <= (right - i) else result[right]
        elif left is not None:
            result[i] = result[left]
        elif right is not None:
            result[i] = result[right]
    return result


# ---------------------------------------------------------------------------
# Header building — multi-level with merged cell propagation
# ---------------------------------------------------------------------------

def _detect_n_header_rows(rows: list, header_start_idx: int, max_check: int = 5) -> int:
    """Count consecutive header-like rows starting at header_start_idx (0-based index in rows)."""

    def _row_looks_like_header(row) -> bool:
        header_like = data_like = 0
        for cell in row:
            v = cell.value
            if v is None:
                continue
            s = str(v).strip()
            if not s:
                continue
            try:
                float(s)
                data_like += 1
            except (ValueError, TypeError):
                if len(s) >= 2:
                    header_like += 1
                else:
                    data_like += 1
        if header_like + data_like == 0:
            return False
        return header_like > data_like

    n = 1
    for i in range(header_start_idx + 1, min(header_start_idx + max_check, len(rows))):
        if _row_looks_like_header(rows[i]):
            n = i - header_start_idx + 1
        else:
            break
    return n


def _build_headers(ws, rows: list, header_start_idx: int, n_header_rows: int, merged_ranges) -> list[str]:
    """Build column names from (possibly multi-level) header rows."""
    header_rows = rows[header_start_idx: header_start_idx + n_header_rows]
    max_col = max((len(r) for r in header_rows), default=0)
    headers: list[str] = []

    for col_idx in range(max_col):
        raw_values: list[Any] = []
        for row_offset, row in enumerate(header_rows):
            actual_row = header_start_idx + row_offset + 1  # 1-based
            actual_col = col_idx + 1  # 1-based
            val = row[col_idx].value if col_idx < len(row) else None
            if val is None:
                val = _get_merged_value(ws, actual_row, actual_col, merged_ranges)
            raw_values.append(val)

        # Fill nearest for this column's header levels
        filled = _fill_row_nearest(raw_values)

        parts: list[str] = []
        for v in filled:
            if v is not None:
                s = str(v).strip()
                if s and s.lower() != "nan" and s not in parts:
                    parts.append(s)

        headers.append("-".join(parts) if parts else f"COL_{col_idx}")

    return headers


# ---------------------------------------------------------------------------
# Hierarchy detection (bold parent rows)
# ---------------------------------------------------------------------------

def _detect_parent_col(ws, data_start_row: int, n_check: int = 20) -> int | None:
    """Return 0-based column index of the first column that has bold cells (parent rows).

    Returns None if no bold cell is found in the first `n_check` data rows.
    """
    actual_rows = ws.max_row or 0
    end_row = min(data_start_row + n_check - 1, actual_rows)
    for row_num in range(data_start_row, end_row + 1):
        for col_idx in range(min(ws.max_column or 1, 5)):
            if _cell_is_bold(ws.cell(row_num, col_idx + 1)):
                return col_idx
    return None


# ---------------------------------------------------------------------------
# Core: parse one sheet → list of per-row chunk strings (RAGFlow style: 1 row = 1 doc)
# ---------------------------------------------------------------------------

def _parse_sheet_to_row_chunks(ws, sheet_name: str) -> list[str]:
    actual_row_count = _get_actual_row_count(ws)
    if actual_row_count == 0:
        logger.info("[Excel] sheet '%s' → empty (0 rows)", sheet_name)
        return []

    logger.info("[Excel] sheet '%s' — %d rows, detecting structure...", sheet_name, actual_row_count)

    merged_ranges = list(ws.merged_cells.ranges)
    if merged_ranges:
        logger.debug("[Excel] sheet '%s' — %d merged range(s)", sheet_name, len(merged_ranges))

    # Actual column count from first 20 rows (avoids phantom cols from openpyxl)
    try:
        preview = list(ws.iter_rows(min_row=1, max_row=min(20, actual_row_count), values_only=True))
        if not preview:
            return []
        n_cols = max(
            (sum(1 for v in row if v is not None) for row in preview),
            default=1,
        )
        n_cols = max(n_cols, 1)
    except Exception:
        n_cols = ws.max_column or 1

    rows = list(ws.iter_rows(min_row=1, max_row=actual_row_count, values_only=False))
    if not rows:
        return []

    # Find where bordered table starts (skips title rows above the actual table)
    header_start_row = _find_header_start_by_border(ws, n_cols)
    header_start_idx = header_start_row - 1
    if header_start_idx >= len(rows):
        header_start_idx = 0

    # Detect number of header rows (multi-level merged headers)
    n_header_rows = _detect_n_header_rows(rows, header_start_idx)
    data_start_idx = header_start_idx + n_header_rows
    if data_start_idx >= len(rows):
        header_start_idx = 0
        n_header_rows = 1
        data_start_idx = 1

    logger.info(
        "[Excel] sheet '%s' — header starts at row %d (%d level(s)), data from row %d, %d col(s)",
        sheet_name, header_start_row, n_header_rows, data_start_idx + 1, n_cols,
    )

    # Build column headers (handles merged cells + fill_row_nearest)
    headers = _build_headers(ws, rows, header_start_idx, n_header_rows, merged_ranges)
    n_cols = len(headers)
    logger.debug("[Excel] sheet '%s' — columns: %s", sheet_name, headers[:10])

    # Detect bold parent-row column (store hierarchy)
    parent_col_idx = _detect_parent_col(ws, data_start_idx + 1)
    if parent_col_idx is not None:
        logger.info("[Excel] sheet '%s' — hierarchy detected (bold col idx=%d)", sheet_name, parent_col_idx)

    row_chunks: list[str] = []
    current_parent: str | None = None
    skipped_empty = 0

    for abs_idx, row in enumerate(rows[data_start_idx:]):
        actual_row_num = data_start_idx + abs_idx + 1

        # Extract cell values, propagating merged cell values
        vals: list[Any] = []
        for col_idx in range(n_cols):
            val = row[col_idx].value if col_idx < len(row) else None
            if val is None:
                val = _get_merged_value(ws, actual_row_num, col_idx + 1, merged_ranges)
            vals.append(val)

        # Skip completely empty rows
        if all(v is None or str(v).strip() in ("", "nan", "None") for v in vals):
            skipped_empty += 1
            continue

        # Track current parent (bold store/category row)
        if parent_col_idx is not None:
            anchor_cell = ws.cell(actual_row_num, parent_col_idx + 1)
            if _cell_is_bold(anchor_cell) and vals[parent_col_idx] is not None:
                current_parent = str(vals[parent_col_idx]).strip()
                logger.debug("[Excel] sheet '%s' row %d — parent: %s", sheet_name, actual_row_num, current_parent)

        # Build key-value lines
        parts: list[str] = []

        # Inject parent context when this row's first col is empty (child row)
        if current_parent is not None and parent_col_idx is not None:
            first_val = vals[parent_col_idx] if parent_col_idx < len(vals) else None
            if first_val is None or str(first_val).strip() in ("", "nan", "None"):
                parts.append(f"- {headers[parent_col_idx]}: {current_parent}")

        for header, val in zip(headers, vals):
            if val is None:
                continue
            s = str(val).strip()
            if s and s not in ("nan", "None"):
                parts.append(f"- {header}: {s}")

        if parts:
            row_chunks.append(f"[{sheet_name}]\n" + "\n".join(parts))

    logger.info(
        "[Excel] sheet '%s' — done: %d row chunk(s), %d empty row(s) skipped",
        sheet_name, len(row_chunks), skipped_empty,
    )
    return row_chunks


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_xlsx_to_page_results(file_bytes: bytes) -> list[PageResult]:
    """Parse an Excel/CSV file into a list of PageResult — one per data row (RAGFlow style).

    Each row becomes an independent PageResult so it is embedded and stored as its own
    vector in Qdrant, giving high retrieval precision (same as RAGFlow's per-row chunking).
    page_number = 1-based sheet index (for citation).
    """
    logger.info("[Excel] start — %.1f KB", len(file_bytes) / 1024)

    try:
        wb = _load_workbook(file_bytes)
    except Exception as e:
        logger.error("[Excel] failed to load workbook: %s", e)
        return []

    total_sheets = len(wb.sheetnames)
    logger.info("[Excel] loaded — %d sheet(s): %s", total_sheets, wb.sheetnames)

    results: list[PageResult] = []
    for sheet_idx, sheet_name in enumerate(wb.sheetnames, 1):
        logger.info("[Excel] processing sheet %d/%d: '%s'", sheet_idx, total_sheets, sheet_name)
        ws = wb[sheet_name]
        try:
            row_chunks = _parse_sheet_to_row_chunks(ws, sheet_name)
        except Exception as e:
            logger.warning("[Excel] skip sheet '%s' due to error: %s", sheet_name, e)
            continue
        for chunk_text in row_chunks:
            results.append(PageResult(sheet_idx, chunk_text, 1.0))

    logger.info(
        "[Excel] done — %d sheet(s) processed, %d total row chunk(s)",
        total_sheets, len(results),
    )
    return results
