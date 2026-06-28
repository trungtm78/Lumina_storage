---
name: xlsx-form-fill
disable-model-invocation: true
description: "Điền thông tin vào template Excel (.xlsx) có sẵn trong hệ thống. Dùng khi user muốn điền dữ liệu vào bảng tính, báo cáo Excel, danh sách — hỗ trợ thay thế giá trị ô và thêm dòng mới vào bảng."
triggers:
  keywords: ["điền", "fill", "excel", "xlsx", "bảng tính", "bảng", "template", "xuất file", "form", "danh sách"]
routing_hint: "User muốn điền/fill bảng tính, báo cáo, danh sách dạng Excel (.xlsx), hoặc hỏi có template Excel gì → PHẢI dùng `xlsx-form-fill`, bắt đầu bằng `parse_document.py`"
---

# Hướng dẫn điền file Excel (.xlsx)

## Scripts có sẵn

### parse_document.py
Đọc template, trả về nội dung các sheet + ô trống.
```
run_script("skills/xlsx-form-fill/tools/parse_document.py", '{"document_id": "<id>"}')
→ {"full_text": "=== Sheet: ... ===\n...", "structure": "Phát hiện N ô cần điền"}
```

### apply_edits.py
Điền thông tin vào template gốc và xuất file. Hỗ trợ 2 loại edit:

**Replace** (sửa giá trị ô có sẵn):
```json
{"action": "replace", "context": "Sheet: Báo cáo - Người bán", "old": "Nguyễn Văn A", "new": "Trần Thị B"}
```

**Insert Row** (thêm dòng mới):
```json
{"action": "insert_row", "context": "Sheet: Danh sách sản phẩm", "after": "H123", "values": ["I123", "SP I", 150000]}
```

## Quy trình

1. `list_directory("workspace", ".xlsx,.xls")` → tìm file Excel
2. `run_script("skills/xlsx-form-fill/tools/parse_document.py", ...)` → xem nội dung + ô trống
3. Thu thập thông tin từ user
4. `run_script("skills/xlsx-form-fill/tools/apply_edits.py", ...)` khi user xác nhận

## Multi-sheet
- Luôn đưa tên sheet vào `context`
- File có thể có nhiều sheet — liệt kê tất cả

## Sửa/bổ sung sau khi đã fill
Hệ thống tự động apply vào **file đã fill gần nhất**. Chỉ cần gửi edits MỚI/SỬA.