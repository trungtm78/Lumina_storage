---
name: document-analysis
disable-model-invocation: true
description: "Phân tích chuyên sâu nội dung tài liệu (pháp lý, tài chính, nhân sự, tổng quát) và xuất báo cáo PDF. Dùng khi user yêu cầu phân tích, tóm tắt, đánh giá rủi ro, so sánh 2 tài liệu, hoặc muốn có báo cáo chi tiết từ file đã upload."
triggers:
  keywords: ["phân tích", "analyze", "tóm tắt", "summary", "đánh giá", "báo cáo", "so sánh", "rủi ro", "review", "kiểm tra", "hợp đồng", "điều khoản"]
routing_hint: "User muốn phân tích, tóm tắt, đánh giá rủi ro, so sánh tài liệu → PHẢI dùng `document-analysis`"
---

# Phân tích tài liệu

## Script: analyze.py

Phân tích tài liệu theo lĩnh vực (pháp lý, tài chính, nhân sự, tổng quát). Tự động nhận diện loại tài liệu. Xuất báo cáo PDF.

### Phân tích 1 tài liệu
```
run_script("skills/document-analysis/tools/analyze.py", '{"document_ids": ["<doc_id>"], "user_request": "<yêu cầu>"}')
```

### So sánh 2 tài liệu
```
run_script("skills/document-analysis/tools/analyze.py", '{"document_ids": ["<doc_id_1>", "<doc_id_2>"], "user_request": "so sánh"}')
```

### Tham số
- `document_ids` (bắt buộc): 1-2 document IDs
- `user_request` (khuyến nghị): yêu cầu cụ thể của user
- `domain_hint` (tùy chọn): "legal" | "finance" | "hr" | "general"

### Kết quả
- `rendered_document_id`: file PDF báo cáo
- `summary`: tóm tắt ngắn
- `domain`: lĩnh vực phát hiện
- `warning_count`: số cảnh báo