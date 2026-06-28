"""OPS-specific endpoints — Phase 2 of the Document Generator project.

Currently scoped to the Excel splitter use case (NCC = nhà cung cấp): OPS
nhận 1 file Excel danh sách sản phẩm trộn nhiều NCC và cần tách thành N file
mỗi NCC một file để gửi đi xử lý đơn hàng.
"""

from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from src.api.deps import CurrentUser
from src.services.ops_excel_splitter import (
    build_summary,
    build_zip,
    read_excel_meta,
    split_workbook_by_column,
)

router = APIRouter(prefix="/ops", tags=["ops"])


class ExcelPreviewResponse(BaseModel):
    columns: list[str]
    sample_rows: list[dict]
    total_rows: int
    sheet_name: str


def _read_xlsx_upload(file: UploadFile) -> bytes:
    name = (file.filename or "").lower()
    if not name.endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Chỉ chấp nhận file .xlsx/.xlsm")
    return file.file.read()


@router.post("/excel/preview", response_model=ExcelPreviewResponse)
async def preview_excel(
    _: CurrentUser,
    file: UploadFile = File(...),
):
    """Đọc Excel để FE hiển thị danh sách cột + sample rows."""
    xlsx_bytes = _read_xlsx_upload(file)
    meta = read_excel_meta(xlsx_bytes)
    return ExcelPreviewResponse(
        columns=meta.columns,
        sample_rows=meta.sample_rows,
        total_rows=meta.total_rows,
        sheet_name=meta.sheet_name,
    )


@router.post("/excel/split")
async def split_excel(
    _: CurrentUser,
    file: UploadFile = File(...),
    group_column: str = Form(...),
    include_summary: bool = Form(True),
    file_prefix: str = Form(""),
):
    """Bóc Excel theo `group_column` và trả về ZIP chứa các file đã tách."""
    xlsx_bytes = _read_xlsx_upload(file)

    try:
        groups = split_workbook_by_column(xlsx_bytes, group_column)
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not groups:
        raise HTTPException(400, "Không có dòng dữ liệu nào để tách.")

    summary = build_summary(xlsx_bytes, group_column) if include_summary else None
    zip_bytes = build_zip(groups, summary_xlsx=summary, file_prefix=file_prefix)

    download_name = (
        (file.filename or "split").rsplit(".", 1)[0] + "_split.zip"
    )
    return StreamingResponse(
        iter([zip_bytes]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{download_name}"',
        },
    )
