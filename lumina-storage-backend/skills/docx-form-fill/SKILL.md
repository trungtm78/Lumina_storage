---
name: docx-form-fill
disable-model-invocation: true
description: "Điền thông tin vào template Word (.docx) có sẵn trong hệ thống. Dùng khi user muốn tạo hợp đồng, biên bản, đơn từ hoặc bất kỳ file Word nào từ template — user cung cấp thông tin, skill tự động điền vào đúng chỗ và xuất file hoàn chỉnh."
triggers:
  keywords: ["điền", "fill", "tạo hợp đồng", "tạo file", "xuất file", "word", "docx", "template", "biên bản", "đơn", "form"]
routing_hint: "User muốn điền/fill/tạo hợp đồng, biên bản, đơn từ, form dạng Word (.docx), hoặc hỏi có template/form gì trong hệ thống → PHẢI dùng `docx-form-fill`, bắt đầu bằng `list_templates.py`"
---

# Điền file Word (.docx)

## ⚠️ Quy tắc bắt buộc
- **KHÔNG TỰ BỊA dữ liệu** — mọi thông tin phải do user cung cấp
- **KHÔNG gọi `fill.py` khi user chưa cung cấp thông tin** — phải hỏi trước
- `user_info` = copy nguyên văn text user gõ, KHÔNG phải structured JSON
- `document_id` = lấy từ kết quả `list_templates` hoặc `search_templates`, KHÔNG tự đặt tên file

## Quy trình bắt buộc

### Bước 1 — Tìm template
```
run_script("skills/docx-form-fill/tools/list_templates.py", '{}')
```
Hoặc tìm theo từ khóa:
```
run_script("skills/docx-form-fill/tools/search_templates.py", '{"query": "thuê mặt bằng"}')
```
→ Trả về: `template_id`, `source_document_id`, `title`, `fields` (danh sách tên trường cần điền)

### Bước 2 — Hỏi user
Hiển thị tên template và danh sách trường cần điền (nhóm theo Bên A / Bên B / Tài chính...).
**Chờ user cung cấp thông tin.** Không bịa, không tiếp tục.

### Bước 3 — Điền file (sau khi có đủ thông tin từ user)
```
run_script("skills/docx-form-fill/tools/fill.py", '{"document_id": "<source_document_id>", "user_info": "<nguyên văn text user cung cấp>"}')
```
Tham số tùy chọn:
- `"template_id": "<template_id>"` — thêm vào để fill chính xác hơn
- `"mode": "update"` — cập nhật file đã fill trước đó thay vì tạo mới