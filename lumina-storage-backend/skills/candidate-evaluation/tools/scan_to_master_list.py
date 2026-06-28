"""Scan batch CVs and append candidate data into a Master List Excel file.

Two actions:
  action="read_headers"  → return column list from an existing Excel file
  action="import"        → parse CVs and append rows to Excel (or create new)
"""

from __future__ import annotations

import asyncio
import io
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parse_cvs import _parse_one_cv, _compact_candidate, CONCURRENCY

from openpyxl import Workbook, load_workbook
from openpyxl.utils import get_column_letter

MAX_CVS = 50
MAX_EXCEL_BYTES = 10 * 1024 * 1024  # 10 MB
STATUS_COLUMN = "Trạng thái"

# Fields extractable from a parsed candidate (mirrors Pydantic Literal in route)
_LIST_FIELDS = {"hard_skills", "soft_skills", "skills", "certifications", "languages"}


def _read_headers_from_bytes(xlsx_bytes: bytes) -> dict:
    """Return {columns, sheet_name} from the first sheet of an xlsx file."""
    wb = load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
    sheet_name = wb.sheetnames[0]
    ws = wb[sheet_name]
    rows_iter = ws.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        wb.close()
        return {"columns": [], "sheet_name": sheet_name}

    columns = [
        str(c) if c is not None else f"Col{idx + 1}"
        for idx, c in enumerate(header_row)
    ]
    wb.close()
    return {"columns": columns, "sheet_name": sheet_name}


def _field_to_cell(candidate: dict, field: str) -> str:
    """Convert a candidate field value to a plain string for an Excel cell."""
    val = candidate.get(field)
    if val is None or val == "":
        return ""
    if field in _LIST_FIELDS:
        if not val:
            return ""
        items = []
        for item in val:
            if isinstance(item, dict):
                # hard_skills: {skill, level, ...}; certifications: {name, issuer, year}; languages: {language, level}
                parts = [
                    item.get("skill") or item.get("name") or item.get("language") or "",
                    item.get("level") or item.get("issuer") or "",
                ]
                items.append(" / ".join(p for p in parts if p))
            else:
                items.append(str(item))
        return ", ".join(items)
    if field == "education":
        if not val:
            return ""
        parts = []
        for edu in val:
            if isinstance(edu, dict):
                degree = edu.get("degree") or ""
                field_s = edu.get("field") or ""
                school = edu.get("school") or ""
                year = edu.get("year") or ""
                parts.append(f"{degree} {field_s} — {school} ({year})".strip(" —()"))
            else:
                parts.append(str(edu))
        return "; ".join(parts)
    return str(val)


def _build_row(candidate: dict, column_mapping: list[dict], header: list[str]) -> list:
    """Build an Excel row (list aligned to header) from candidate + mapping."""
    row = [""] * len(header)
    for mapping in column_mapping:
        extracted_field = mapping["extracted_field"]
        target_col = mapping["target_column"]
        if target_col not in header:
            continue
        col_idx = header.index(target_col)
        row[col_idx] = _field_to_cell(candidate, extracted_field)
    return row


def _dedup_key(candidate: dict) -> tuple[str, str]:
    """Return (email, phone) for dedup lookup — empty string if absent."""
    email = (candidate.get("email") or "").strip().lower()
    phone = (candidate.get("phone") or "").strip().replace(" ", "").replace("-", "")
    return email, phone


def _build_dedup_set(ws, header: list[str]) -> set[tuple[str, str]]:
    """Scan existing rows to build a set of (email, phone) keys."""
    email_idx = header.index("email") if "email" in header else None
    phone_idx = header.index("phone") if "phone" in header else None

    # Also check mapped target columns that might carry email/phone
    seen: set[tuple[str, str]] = set()
    for row in ws.iter_rows(min_row=2, values_only=True):
        email = ""
        phone = ""
        if email_idx is not None and email_idx < len(row):
            email = str(row[email_idx] or "").strip().lower()
        if phone_idx is not None and phone_idx < len(row):
            phone = str(row[phone_idx] or "").strip().replace(" ", "").replace("-", "")
        if email or phone:
            seen.add((email, phone))
    return seen


def _dedup_set_from_column_mapping(
    ws, header: list[str], column_mapping: list[dict],
) -> tuple[set[str], set[str]]:
    """Return (existing_emails, existing_phones) scanning rows via column mapping."""
    email_target = next(
        (m["target_column"] for m in column_mapping if m["extracted_field"] == "email"), None,
    )
    phone_target = next(
        (m["target_column"] for m in column_mapping if m["extracted_field"] == "phone"), None,
    )
    email_col_idx = header.index(email_target) if email_target and email_target in header else None
    phone_col_idx = header.index(phone_target) if phone_target and phone_target in header else None

    existing_emails: set[str] = set()
    existing_phones: set[str] = set()
    for row in ws.iter_rows(min_row=2, values_only=True):
        if email_col_idx is not None and email_col_idx < len(row):
            val = str(row[email_col_idx] or "").strip().lower()
            if val:
                existing_emails.add(val)
        if phone_col_idx is not None and phone_col_idx < len(row):
            val = str(row[phone_col_idx] or "").strip().replace(" ", "").replace("-", "")
            if val:
                existing_phones.add(val)
    return existing_emails, existing_phones


def _is_duplicate(
    candidate: dict,
    existing_emails: set[str],
    existing_phones: set[str],
) -> bool:
    """Priority: email match → phone match (no email) → not duplicate."""
    email, phone = _dedup_key(candidate)
    if email and email in existing_emails:
        return True
    if phone and not email and phone in existing_phones:
        return True
    return False


async def _do_import(args: dict, ctx) -> dict:
    document_ids: list[str] = args.get("document_ids", [])
    master_list_doc_id: str | None = args.get("master_list_document_id")
    column_mapping: list[dict] = args.get("column_mapping", [])

    if not document_ids:
        return {"error": "Cần cung cấp document_ids chứa ID các file CV."}
    if not column_mapping:
        return {"error": "Cần cung cấp column_mapping để biết ghi vào cột nào."}
    if len(document_ids) > MAX_CVS:
        return {"error": f"Tối đa {MAX_CVS} CV mỗi lần. Đã nhận {len(document_ids)}."}

    # ── Step 1: Parse all CVs in parallel ────────────────────────────────────
    sem = asyncio.Semaphore(CONCURRENCY)
    tasks = [
        _parse_one_cv(ctx, sem, doc_id, i)
        for i, doc_id in enumerate(document_ids)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    successes: list[dict] = []
    failures: list[dict] = []
    for i, r in enumerate(results):
        doc_id = document_ids[i]
        if isinstance(r, Exception):
            failures.append({"document_id": doc_id, "error": str(r), "name": doc_id})
        else:
            compact = _compact_candidate(r)
            if compact.get("error"):
                failures.append(compact)
            else:
                successes.append(compact)

    if not successes:
        err_msgs = "; ".join(f.get("error", "?") for f in failures[:3])
        return {
            "error": f"Không bóc tách được CV nào trong {len(document_ids)} file. {err_msgs}",
        }

    # ── Step 2: Load or create workbook ──────────────────────────────────────
    if master_list_doc_id:
        try:
            xlsx_bytes = await ctx.get_document_bytes(master_list_doc_id)
        except Exception as e:
            return {"error": f"Không thể tải Master List: {e}"}

        if len(xlsx_bytes) > MAX_EXCEL_BYTES:
            return {"error": f"File Master List quá lớn (> {MAX_EXCEL_BYTES // 1024 // 1024} MB)."}

        wb = load_workbook(io.BytesIO(xlsx_bytes))
        ws = wb.active
        # Read header
        header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True), None)
        if not header_row:
            return {"error": "Master List không có dòng header."}
        header = [
            str(c) if c is not None else f"Col{idx + 1}"
            for idx, c in enumerate(header_row)
        ]
        # Add status column if not present
        if STATUS_COLUMN not in header:
            header.append(STATUS_COLUMN)
            ws.cell(row=1, column=len(header), value=STATUS_COLUMN)
        status_col_idx = header.index(STATUS_COLUMN)
        existing_emails, existing_phones = _dedup_set_from_column_mapping(ws, header, column_mapping)
        next_row = ws.max_row + 1
    else:
        # Create new workbook with columns from mapping + status column
        wb = Workbook()
        ws = wb.active
        ws.title = "Master List"
        header = [m["target_column"] for m in column_mapping]
        if STATUS_COLUMN not in header:
            header.append(STATUS_COLUMN)
        ws.append(header)
        status_col_idx = header.index(STATUS_COLUMN)
        existing_emails: set[str] = set()
        existing_phones: set[str] = set()
        next_row = 2

    # ── Step 3: Append rows ───────────────────────────────────────────────────
    import_log: list[dict] = []

    for candidate in successes:
        is_dup = _is_duplicate(candidate, existing_emails, existing_phones)
        row_data = _build_row(candidate, column_mapping, header)
        row_data[status_col_idx] = "Needs Review" if is_dup else "OK"

        ws.append(row_data)
        current_row = next_row
        next_row += 1

        # Update dedup sets so intra-batch duplicates are also caught
        email, phone = _dedup_key(candidate)
        if email:
            existing_emails.add(email)
        if phone:
            existing_phones.add(phone)

        import_log.append({
            "candidate_name": candidate.get("name") or candidate.get("original_filename") or "?",
            "document_id": candidate.get("document_id", ""),
            "status": "needs_review" if is_dup else "success",
            "row_number": current_row,
            "message": "Trùng email hoặc SĐT — cần kiểm tra." if is_dup else None,
        })

    # Failed CVs get a log entry but no row in Excel
    for f in failures:
        import_log.append({
            "candidate_name": f.get("name") or f.get("original_filename") or f.get("document_id", "?"),
            "document_id": f.get("document_id", ""),
            "status": "failed",
            "row_number": None,
            "message": f.get("error"),
        })

    # ── Step 4: Auto-size columns ─────────────────────────────────────────────
    for col_idx in range(1, len(header) + 1):
        max_len = 0
        col_letter = get_column_letter(col_idx)
        for cell in ws[col_letter]:
            if cell.value:
                max_len = max(max_len, len(str(cell.value)))
        ws.column_dimensions[col_letter].width = min(max(12, max_len + 2), 60)

    # ── Step 5: Save to storage ───────────────────────────────────────────────
    buf = io.BytesIO()
    wb.save(buf)
    xlsx_out = buf.getvalue()

    # save_rendered_document needs a source document to inherit storage_config from.
    # Use the master list if provided, otherwise use the first CV.
    source_doc_id = master_list_doc_id or document_ids[0]
    try:
        output_doc_uuid = await ctx.save_rendered_document(
            xlsx_out,
            source_document_id=source_doc_id,
            filename_suffix="_master_list_import",
            mime_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            extension="xlsx",
        )
        output_doc_id = str(output_doc_uuid)
    except Exception as e:
        return {"error": f"Không thể lưu file output: {e}"}

    success_count = sum(1 for e in import_log if e["status"] == "success")
    needs_review_count = sum(1 for e in import_log if e["status"] == "needs_review")
    failed_count = sum(1 for e in import_log if e["status"] == "failed")

    return {
        "output_document_id": output_doc_id,
        "success_count": success_count,
        "failed_count": failed_count,
        "needs_review_count": needs_review_count,
        "import_log": import_log,
    }


async def run(args: dict, ctx) -> dict:
    action = args.get("action", "import")

    if action == "read_headers":
        master_list_doc_id = args.get("master_list_document_id")
        if not master_list_doc_id:
            return {"error": "Cần cung cấp master_list_document_id."}
        try:
            xlsx_bytes = await ctx.get_document_bytes(master_list_doc_id)
        except Exception as e:
            return {"error": f"Không thể tải file: {e}"}
        if len(xlsx_bytes) > MAX_EXCEL_BYTES:
            return {"error": f"File quá lớn (> {MAX_EXCEL_BYTES // 1024 // 1024} MB)."}
        return _read_headers_from_bytes(xlsx_bytes)

    return await _do_import(args, ctx)
