"""Seed a demo Sales Ops contract template that exercises the Phase 1 schema.

The template mirrors the GotIt Sales Ops requirement spreadsheet — 22 input
fields organized into customer / contract / phụ-lục-optional sections, with
explicit `select` types pulling from the curated preset catalog.

Run:
    python scripts/seed_sales_ops_template.py            # skip if already seeded
    python scripts/seed_sales_ops_template.py --force    # delete + recreate

Idempotency: detected by exact `title` match on `source_type='template'`
documents owned by the admin user (UUID 0000…0002).
"""
from __future__ import annotations

import argparse
import asyncio
import io
import sys
import uuid
from io import BytesIO
from pathlib import Path
from typing import Any

# Ensure project root is in path so `src.*` imports resolve.
sys.path.insert(0, str(Path(__file__).parent.parent))


def _force_utf8_stdout() -> None:
    """Switch stdout to UTF-8 — Windows console defaults to cp1252 and crashes
    on the Vietnamese strings printed on success. Only called from __main__ so
    importing this module from pytest doesn't clobber pytest's captured stdout.
    """
    if hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from docx import Document as DocxDocument
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from src.core.config import get_settings
from src.core.template_presets import TEMPLATE_FIELD_PRESETS
from src.models.document import Document
from src.models.storage import StorageConfig
from src.models.user import User
from src.services.storage import get_storage_backend

ADMIN_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")

TEMPLATE_TITLE = "Hợp đồng nguyên tắc Sales Ops (Demo)"
TEMPLATE_FILENAME = "hop_dong_nguyen_tac_sales_ops_demo.docx"

SECTIONS = [
    {"key": "customer", "label": "Thông tin Khách hàng", "order": 1},
    {"key": "contract", "label": "Thông tin Hợp đồng & Điều khoản thương mại", "order": 2},
    {"key": "phu_luc", "label": "Phụ lục / PO trên Hợp đồng sẵn có (tuỳ chọn)", "order": 3},
]


def _required(field_dict: dict[str, Any]) -> dict[str, Any]:
    field_dict.setdefault("required", True)
    return field_dict


def _optional(field_dict: dict[str, Any]) -> dict[str, Any]:
    field_dict["required"] = False
    return field_dict


# Field spec — matches Excel sheet "Thông tin đầu vào".
FIELDS: list[dict[str, Any]] = [
    # ── Section I: THÔNG TIN KHÁCH HÀNG ──────────────────────────────────────
    _required({"placeholder": "ten_cong_ty", "label": "Tên công ty (Tiếng Việt)",
               "type": "blank", "section_key": "customer"}),
    _required({"placeholder": "ma_so_thue",
               "label": "Mã số thuế / Số quyết định / Số GP thành lập",
               "type": "blank", "section_key": "customer"}),
    _required({"placeholder": "dia_chi", "label": "Địa chỉ ĐKKD",
               "type": "blank", "section_key": "customer"}),
    _optional({"placeholder": "so_dien_thoai", "label": "Số điện thoại",
               "type": "blank", "section_key": "customer"}),
    _required({"placeholder": "nguoi_dai_dien", "label": "Người đại diện ký kết",
               "type": "blank", "section_key": "customer"}),
    _required({"placeholder": "chuc_vu", "label": "Chức vụ",
               "type": "blank", "section_key": "customer"}),
    _optional({"placeholder": "thong_tin_guq",
               "label": "Thông tin GUQ (số, ngày)",
               "type": "blank", "section_key": "customer"}),

    # ── Section II: THÔNG TIN HỢP ĐỒNG ────────────────────────────────────────
    _required({"placeholder": "loai_van_ban", "label": "Loại văn bản cần soạn thảo",
               "type": "select", "section_key": "contract",
               "options": TEMPLATE_FIELD_PRESETS["doc_type"]}),
    _required({"placeholder": "ngon_ngu", "label": "Ngôn ngữ văn bản",
               "type": "select", "section_key": "contract",
               "options": TEMPLATE_FIELD_PRESETS["language"]}),
    _required({"placeholder": "thoi_han", "label": "Thời hạn của văn bản",
               "type": "blank", "section_key": "contract"}),
    _required({"placeholder": "san_pham",
               "label": "Loại sản phẩm / voucher / dịch vụ",
               "type": "blank", "section_key": "contract"}),
    _optional({"placeholder": "hinh_thuc_doi_soat", "label": "Hình thức đối soát",
               "type": "blank", "section_key": "contract"}),
    _required({"placeholder": "phuong_thuc_thanh_toan",
               "label": "Phương thức thanh toán",
               "type": "select", "section_key": "contract",
               "options": TEMPLATE_FIELD_PRESETS["payment_method"]}),
    _optional({"placeholder": "dat_coc", "label": "Đặt cọc",
               "type": "blank", "section_key": "contract"}),
    _required({"placeholder": "thoi_han_thanh_toan", "label": "Thời hạn thanh toán",
               "type": "blank", "section_key": "contract"}),
    _required({"placeholder": "chinh_sach_ban_hang", "label": "Chính sách bán hàng",
               "type": "select", "section_key": "contract",
               "options": TEMPLATE_FIELD_PRESETS["sales_policy"]}),
    _optional({"placeholder": "chinh_sach_khac",
               "label": "Ghi rõ thông tin nếu chính sách bán hàng = Khác",
               "type": "blank", "section_key": "contract"}),
    _optional({"placeholder": "duong_dan_bao_gia", "label": "Đường dẫn báo giá",
               "type": "blank", "section_key": "contract"}),
    _optional({"placeholder": "luu_y", "label": "Lưu ý / mô tả khác",
               "type": "textarea", "section_key": "contract"}),

    # ── Section III: PHỤ LỤC / PO TUỲ CHỌN ───────────────────────────────────
    _optional({"placeholder": "duong_dan_hop_dong", "label": "Đường dẫn Hợp đồng",
               "type": "blank", "section_key": "phu_luc"}),
    _optional({"placeholder": "chinh_sach_hd",
               "label": "Chính sách bán hàng của Hợp đồng",
               "type": "select", "section_key": "phu_luc",
               "options": TEMPLATE_FIELD_PRESETS["sales_policy"]}),
    _optional({"placeholder": "chinh_sach_hd_khac",
               "label": "Ghi rõ thông tin nếu chính sách = Khác",
               "type": "blank", "section_key": "phu_luc"}),
    _optional({"placeholder": "luu_y_hd",
               "label": "Lưu ý / mô tả khác (Hợp đồng)",
               "type": "textarea", "section_key": "phu_luc"}),
]


def _build_docx() -> bytes:
    """Build a contract-shaped DOCX with `{placeholder}` markers."""
    doc = DocxDocument()
    doc.add_heading("HỢP ĐỒNG NGUYÊN TẮC", level=0)
    doc.add_paragraph("(V/v: Cung cấp sản phẩm / dịch vụ)")
    doc.add_paragraph("Số: ____/HĐNT/DAYONE")

    doc.add_paragraph(
        "Căn cứ Bộ luật Dân sự số 91/2015/QH13 ngày 24/11/2015;"
    )
    doc.add_paragraph(
        "Căn cứ Luật Thương mại số 36/2005/QH11 ngày 14/06/2005;"
    )
    doc.add_paragraph("Căn cứ vào nhu cầu và khả năng của Các Bên,")
    doc.add_paragraph("Hôm nay, chúng tôi gồm:")

    doc.add_heading("BÊN A (Khách hàng)", level=2)
    doc.add_paragraph("Tên công ty: {ten_cong_ty}")
    doc.add_paragraph("Mã số thuế / GP thành lập: {ma_so_thue}")
    doc.add_paragraph("Địa chỉ: {dia_chi}")
    doc.add_paragraph("Số điện thoại: {so_dien_thoai}")
    doc.add_paragraph("Đại diện: {nguoi_dai_dien} — Chức vụ: {chuc_vu}")
    doc.add_paragraph("Giấy ủy quyền: {thong_tin_guq}")

    doc.add_heading("BÊN B (Dayone)", level=2)
    doc.add_paragraph("CÔNG TY CỔ PHẦN DAYONE")
    doc.add_paragraph(
        "Địa chỉ: 102 Nguyễn Đình Chính, Phường Cầu Kiệu, TP. Hồ Chí Minh"
    )
    doc.add_paragraph("Mã số thuế: 0313249098")
    doc.add_paragraph("Đại diện: Bà Trần Nguyễn Uyên Vi — Chức vụ: Giám đốc thương mại cao cấp")

    doc.add_heading("ĐIỀU 1. NỘI DUNG HỢP ĐỒNG", level=2)
    doc.add_paragraph(
        "Loại văn bản: {loai_van_ban}. Ngôn ngữ: {ngon_ngu}. "
        "Thời hạn: {thoi_han}."
    )
    doc.add_paragraph("Sản phẩm / dịch vụ: {san_pham}.")
    doc.add_paragraph("Hình thức đối soát: {hinh_thuc_doi_soat}.")

    doc.add_heading("ĐIỀU 2. THANH TOÁN", level=2)
    doc.add_paragraph(
        "Phương thức thanh toán: {phuong_thuc_thanh_toan}. "
        "Đặt cọc: {dat_coc}. "
        "Thời hạn thanh toán: {thoi_han_thanh_toan}."
    )

    doc.add_heading("ĐIỀU 3. CHÍNH SÁCH BÁN HÀNG", level=2)
    doc.add_paragraph(
        "Chính sách bán hàng: {chinh_sach_ban_hang}. "
        "Ghi chú nếu chọn Khác: {chinh_sach_khac}."
    )
    doc.add_paragraph("Báo giá tham chiếu: {duong_dan_bao_gia}.")

    doc.add_heading("ĐIỀU 4. PHỤ LỤC TRÊN HỢP ĐỒNG SẴN CÓ (tuỳ chọn)", level=2)
    doc.add_paragraph("Hợp đồng tham chiếu: {duong_dan_hop_dong}.")
    doc.add_paragraph(
        "Chính sách bán hàng của Hợp đồng: {chinh_sach_hd}. "
        "Ghi chú nếu Khác: {chinh_sach_hd_khac}."
    )
    doc.add_paragraph("Lưu ý Hợp đồng: {luu_y_hd}.")

    doc.add_heading("ĐIỀU 5. LƯU Ý KHÁC", level=2)
    doc.add_paragraph("{luu_y}")

    doc.add_heading("ĐẠI DIỆN CÁC BÊN", level=2)
    doc.add_paragraph("BÊN A                                      BÊN B")
    doc.add_paragraph("(Ký, đóng dấu, ghi rõ họ tên)              (Ký, đóng dấu, ghi rõ họ tên)")

    out = BytesIO()
    doc.save(out)
    return out.getvalue()


def _build_template_fields() -> list[dict[str, Any]]:
    """Convert FIELDS spec into the v2 metadata shape persisted in source_metadata."""
    out: list[dict[str, Any]] = []
    for idx, f in enumerate(FIELDS):
        out.append(
            {
                "id": f"f{idx}",
                "placeholder": f["placeholder"],
                "label": f["label"],
                "description": "",
                "location": f"para_{idx}",
                "type": f["type"],
                "options": f.get("options"),
                "section_key": f["section_key"],
                "required": f["required"],
            }
        )
    return out


async def _delete_existing(db: AsyncSession, owner_id: uuid.UUID) -> int:
    """Hard-delete any prior copies of the demo template (and their files)."""
    rows = (
        await db.execute(
            select(Document).where(
                Document.title == TEMPLATE_TITLE,
                Document.source_type == "template",
                Document.owner_id == owner_id,
            )
        )
    ).scalars().all()

    if not rows:
        return 0

    for doc in rows:
        storage_cfg = await db.get(StorageConfig, doc.storage_config_id)
        if storage_cfg:
            backend = get_storage_backend(storage_cfg)
            try:
                await backend.delete(doc.file_path)
            except Exception as exc:
                print(f"  warn: could not delete file {doc.file_path}: {exc}")
        await db.delete(doc)

    await db.commit()
    return len(rows)


async def main(force: bool) -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, echo=False)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as db:
        # 1. Ensure admin user exists (the seed migration creates it; bail loudly if not).
        admin = await db.get(User, ADMIN_USER_ID)
        if not admin:
            raise SystemExit(
                "Admin user not found. Run alembic migrations first "
                "(seed_admin_user)."
            )

        # 2. Check for existing demo template
        existing_count_q = await db.execute(
            select(Document.id).where(
                Document.title == TEMPLATE_TITLE,
                Document.source_type == "template",
                Document.owner_id == ADMIN_USER_ID,
            )
        )
        existing = list(existing_count_q.scalars().all())

        if existing and not force:
            print(
                f"Demo template '{TEMPLATE_TITLE}' already exists "
                f"({len(existing)} copy). Use --force to recreate."
            )
            return

        if existing and force:
            removed = await _delete_existing(db, ADMIN_USER_ID)
            print(f"Removed {removed} prior copy/copies.")

        # 3. Pick the default storage config
        storage_cfg = (
            await db.execute(
                select(StorageConfig).where(StorageConfig.is_default.is_(True)).limit(1)
            )
        ).scalar_one_or_none()
        if not storage_cfg:
            raise SystemExit(
                "No default storage config. Run alembic migrations first."
            )

        backend = get_storage_backend(storage_cfg)

        # 4. Build + persist the DOCX
        docx_bytes = _build_docx()
        save_result = await backend.save(docx_bytes, TEMPLATE_FILENAME)

        # 5. Insert Document row with full v2 metadata
        template_fields = _build_template_fields()
        doc = Document(
            id=uuid.uuid4(),
            title=TEMPLATE_TITLE,
            description=(
                "Template demo dựng theo file requirement Sales Ops của GotIt — "
                "22 trường gom thành 3 section, có select dropdown từ preset."
            ),
            file_name=save_result.file_name,
            original_filename=TEMPLATE_FILENAME,
            file_path=save_result.file_path,
            file_size=save_result.file_size,
            mime_type=(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            ),
            extension=".docx",
            checksum=save_result.checksum,
            storage_config_id=storage_cfg.id,
            owner_id=ADMIN_USER_ID,
            source_type="template",
            source_metadata={
                "template_fields": template_fields,
                "extraction_status": "completed",
                "language_mode": "single",
                "sections": SECTIONS,
            },
        )
        db.add(doc)
        await db.commit()

        print(f"Seeded template '{TEMPLATE_TITLE}'")
        print(f"  id:        {doc.id}")
        print(f"  fields:    {len(template_fields)}")
        print(f"  sections:  {[s['key'] for s in SECTIONS]}")
        print(f"  storage:   {save_result.file_path}")

    await engine.dispose()


if __name__ == "__main__":
    _force_utf8_stdout()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force", action="store_true",
        help="Delete any prior copy of the demo template and recreate.",
    )
    args = parser.parse_args()
    asyncio.run(main(force=args.force))
