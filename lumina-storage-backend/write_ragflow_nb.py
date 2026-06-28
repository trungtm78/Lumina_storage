import json

XLSX_PATH = "uploads/2026/03/97fb555d-8c66-47b5-914b-b81f81c3d813.xlsx"
SHEET = "DT 01.2026"

def cell(src):
    return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": src}

def md(src):
    return {"cell_type": "markdown", "metadata": {}, "source": src}

cells = [
    md("# RAGFlow-style Excel Parser — Test merged cells\n\nPort logic từ `rag/app/table.py` của RAGFlow để xử lý merged cells đúng cách."),

    cell("""\
import openpyxl
import pandas as pd

XLSX_PATH = "uploads/2026/03/97fb555d-8c66-47b5-914b-b81f81c3d813.xlsx"
SHEET = "DT 01.2026"

wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)
ws = wb[SHEET]

print("Sheet:", SHEET)
print("Max row:", ws.max_row, "Max col:", ws.max_col)
print()

# Show all merged ranges
merged = list(ws.merged_cells.ranges)
print(f"Merged ranges ({len(merged)} total):")
for r in merged[:30]:
    anchor = ws.cell(r.min_row, r.min_col).value
    print(f"  {r}  anchor_value={anchor!r}")
"""),

    cell("""\
# Đọc tất cả rows thành list of lists (raw openpyxl cells)
rows_raw = list(ws.iter_rows(values_only=False))
print(f"Total rows: {len(rows_raw)}")

# Xem 10 row đầu, 10 col đầu
print("\\nFirst 10 rows x 10 cols (raw value):")
for i, row in enumerate(rows_raw[:10]):
    vals = [str(c.value)[:15] if c.value is not None else "None" for c in row[:10]]
    print(f"  Row {i+1}: {vals}")
"""),

    cell("""\
# --- Port từ RAGFlow ---

def get_merged_value(ws, row, col, merged_ranges):
    \"\"\"Nếu cell (row, col) nằm trong 1 merged range, trả về value của anchor cell (top-left).\"\"\"
    for rng in merged_ranges:
        if rng.min_row <= row <= rng.max_row and rng.min_col <= col <= rng.max_col:
            return ws.cell(rng.min_row, rng.min_col).value
    return None


def row_looks_like_header(row):
    \"\"\"Heuristic: row có nhiều string cell hơn số cell -> likely header.\"\"\"
    header_like = 0
    data_like = 0
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


def detect_header_rows(rows, max_check=5):
    \"\"\"Trả về số header rows (1-based count).\"\"\"
    if len(rows) < 2:
        return 1
    n_headers = 1
    for i in range(1, min(max_check, len(rows))):
        if row_looks_like_header(rows[i]):
            n_headers = i + 1
        else:
            break
    return n_headers


def build_hierarchical_headers(ws, rows, n_header_rows, merged_ranges):
    \"\"\"Ghép multi-level headers thành 1 tên cột duy nhất per column.\"\"\"
    max_col = max(len(row) for row in rows[:n_header_rows])
    headers = []
    for col_idx in range(max_col):
        parts = []
        for row_idx in range(n_header_rows):
            row = rows[row_idx]
            if col_idx >= len(row):
                continue
            val = row[col_idx].value
            # Nếu None -> check merged
            if val is None:
                val = get_merged_value(ws, row_idx + 1, col_idx + 1, merged_ranges)
            if val is not None:
                s = str(val).strip()
                if s and s != "nan" and s not in parts:
                    parts.append(s)
        headers.append("-".join(parts) if parts else f"COL_{col_idx}")
    return headers


def extract_data_rows(ws, rows, n_header_rows, n_cols, merged_ranges):
    \"\"\"Extract data rows, propagate merged cell values.\"\"\"
    result = []
    for abs_row_idx, row in enumerate(rows[n_header_rows:], start=n_header_rows):
        row_data = []
        actual_row_num = abs_row_idx + 1
        for col_idx in range(n_cols):
            actual_col_num = col_idx + 1
            val = None
            if col_idx < len(row):
                val = row[col_idx].value
            if val is None:
                val = get_merged_value(ws, actual_row_num, actual_col_num, merged_ranges)
            row_data.append(val)
        result.append(row_data)
    return result


print("Functions defined.")
"""),

    cell("""\
merged_ranges = list(ws.merged_cells.ranges)
rows_raw = list(ws.iter_rows(values_only=False))

n_header_rows = detect_header_rows(rows_raw)
print(f"Detected header rows: {n_header_rows}")

headers = build_hierarchical_headers(ws, rows_raw, n_header_rows, merged_ranges)
print(f"\\nTotal columns: {len(headers)}")
print("\\nFirst 15 column names:")
for i, h in enumerate(headers[:15]):
    print(f"  [{i}] {h}")
"""),

    cell("""\
# Build DataFrame
data = extract_data_rows(ws, rows_raw, n_header_rows, len(headers), merged_ranges)

df = pd.DataFrame(data, columns=headers)

# Drop all-None columns
df = df.dropna(axis=1, how="all")

# Drop rows where first col is empty
fc = df.columns[0]
df = df[df[fc].notna() & df[fc].astype(str).str.strip().ne("")]
df = df.reset_index(drop=True)

print(f"Shape: {df.shape}")
print("\\nColumns:")
for c in df.columns:
    print(f"  {c}")
df.head(5)
"""),

    cell("""\
# So sánh với cách cũ (pandas header=None)
df_old = pd.read_excel(XLSX_PATH, sheet_name=SHEET, header=None)
print("pandas header=None shape:", df_old.shape)
print("First 3 rows:")
df_old.head(3)
"""),

    cell("""\
# RAGFlow-style: format mỗi row thành key-value chunk
def row_to_chunk(row, headers, sheet_name):
    parts = []
    for h, v in zip(headers, row):
        if v is not None and str(v).strip() not in ("", "nan", "None"):
            parts.append(f"- {h}: {v}")
    return f"[{sheet_name}]\\n" + "\\n".join(parts)

# Demo: xem 3 chunk đầu
for i in range(min(3, len(df))):
    chunk = row_to_chunk(df.iloc[i].tolist(), df.columns.tolist(), SHEET)
    print(f"=== Chunk {i} ===")
    print(chunk[:600])
    print()
"""),

    cell("""\
# Tìm kiếm: doanh thu 98 Nguyen Van Troi
import unicodedata

def norm(s):
    return unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode().lower()

store_col = df.columns[0]
mask = df[store_col].astype(str).map(norm).str.contains(norm("Nguyen Van Troi"))
result = df[mask]
print(f"Found {len(result)} rows for '98 Nguyen Van Troi'")
result
"""),
]

nb = {
    "cells": cells,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": "3.12.0"},
    },
    "nbformat": 4,
    "nbformat_minor": 5,
}

with open("test_ragflow_excel.ipynb", "w", encoding="utf-8") as f:
    json.dump(nb, f, ensure_ascii=False, indent=1)

print("Written: test_ragflow_excel.ipynb")
