"""Curated dropdown values for `select` template fields.

Sourced from GotIt Sales Ops requirement spreadsheet (sheet `data`). The frontend
uses these as suggestions when the user configures a `select` field; the backend
exposes them at `GET /generator/field-presets` so frontend doesn't hard-code
duplicates.
"""

TEMPLATE_FIELD_PRESETS: dict[str, list[str]] = {
    "language": [
        "Đơn ngữ",
        "Song ngữ",
    ],
    # 6 categories from the GotIt Legal catalog "DANH MỤC VĂN BẢN MẪU KÝ KẾT
    # VỚI KH B2B" (sheet "2. Hướng dẫn áp dụng", T9/2025). Order matches the
    # catalog's logical flow: master agreement → service contract → product
    # annexes → adjustment annexes → attachments → standalone PO.
    "doc_type": [
        "Hợp đồng nguyên tắc",
        "Hợp đồng dịch vụ",
        "Phụ lục sản phẩm/dịch vụ",
        "Phụ lục điều chỉnh",
        "Bản đính kèm",
        "Đơn Đặt Hàng (1 trang)",
    ],
    "contract_type": [
        "Khung (theo mẫu DO)",
        "Khung (theo mẫu Khách hàng)",
        "One-off (theo mẫu DO)",
        "One-off (theo mẫu Khách hàng)",
        "Không có hợp đồng (process bằng PO)",
    ],
    "payment_method": [
        "Trả trước",
        "Trả sau",
        "Trả theo đợt",
    ],
    "sales_policy": [
        "GRR",
        "Chiết khấu trực tiếp",
        "Chiết khấu theo năm hợp đồng",
        "Thanh toán trên sử dụng (onredeem)",
        "Khác",
    ],
}
