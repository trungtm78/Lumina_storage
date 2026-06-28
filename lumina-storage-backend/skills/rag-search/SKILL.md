---
name: rag-search
description: "Tìm kiếm và trả lời câu hỏi dựa trên nội dung tài liệu trong knowledge base. PHẢI dùng skill này cho MỌI câu hỏi về dữ liệu, số liệu, sự kiện, thông tin cụ thể — kể cả khi câu hỏi không có từ 'tìm kiếm'. Ví dụ: hỏi về doanh thu, chi phí, điều khoản hợp đồng, ngày tháng, tên người... đều phải gọi skill này."
triggers:
  keywords: ["tìm", "search", "tìm kiếm", "tra cứu", "có thông tin gì", "nội dung", "bao nhiêu", "là gì", "như thế nào", "khi nào", "ai", "ở đâu"]
routing_hint: "User hỏi thông tin, tra cứu số liệu, sự kiện, nội dung tài liệu cụ thể → dùng `rag-search`"
---

# Tìm kiếm Knowledge Base

## Script: search

Tìm kiếm nội dung tài liệu bằng semantic search (vector similarity).

### Cách gọi

```
run_script("skills/rag-search/tools/search.py", '{"query": "<câu truy vấn>"}')
```

### Tham số
- `query` (bắt buộc): Câu truy vấn tìm kiếm bằng ngôn ngữ tự nhiên
- `top_k` (optional, default 5): Số kết quả trả về

### Kết quả
- `answer`: Text kết quả đã format với citations [1], [2]...
- `_sources`: Danh sách sources cho frontend hiển thị

### Ví dụ

```
run_script("skills/rag-search/tools/search.py", '{"query": "điều khoản hợp đồng thuê nhà"}')
```

## Quy tắc
- Chèn [1], [2] sau mỗi trích dẫn
- Trả lời bằng tiếng Việt
- Nếu không tìm thấy → nói rõ "Không tìm thấy tài liệu liên quan"