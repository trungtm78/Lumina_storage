---
name: candidate-evaluation
disable-model-invocation: true
description: "Đánh giá ứng viên: phân tích JD (Job Description), bóc tách CV hàng loạt, chấm điểm + xếp hạng ứng viên theo JD, tạo câu hỏi phỏng vấn, xuất báo cáo PDF. Dùng khi user muốn tuyển dụng, sàng lọc CV, đánh giá ứng viên."
triggers:
  keywords: ["tuyển dụng", "ứng viên", "candidate", "JD", "job description", "CV", "resume", "phỏng vấn", "interview", "shortlist", "sàng lọc", "đánh giá ứng viên", "evaluate candidate"]
---

# Đánh giá ứng viên (Candidate Evaluation)

Skill hỗ trợ quy trình tuyển dụng theo 5 bước: phân tích JD → bóc tách CV → chấm điểm → câu hỏi phỏng vấn → báo cáo PDF.

## Quy trình

### Bước 1: Phân tích JD
```
run_script("skills/candidate-evaluation/tools/parse_jd.py", '{"document_ids": ["<jd_doc_id>"]}')
```
Kết quả: structured JD (required skills, nice-to-have, experience, location, role details). Lưu vào _state.

### Bước 2: Bóc tách CV
```
run_script("skills/candidate-evaluation/tools/parse_cvs.py", '{"document_ids": ["<cv1>", "<cv2>", ...]}')
```
Truyền nhiều CV cùng lúc. Kết quả: danh sách candidates (name, experience, skills, education). Tự động merge nếu đã có candidates trước đó.

### Bước 3: Chấm điểm + Xếp hạng
```
run_script("skills/candidate-evaluation/tools/match_candidates.py", '{"top_n": 5}')
```
- top_n (tùy chọn, default=5): số ứng viên shortlist.
- Dùng JD + candidates từ _state. Trả về ranked list với điểm 0-100.

### Bước 4: Câu hỏi phỏng vấn
```
run_script("skills/candidate-evaluation/tools/generate_questions.py", '{"candidate_indices": [0, 1, 2]}')
```
- candidate_indices (tùy chọn): chỉ tạo cho ứng viên cụ thể. Mặc định = tất cả shortlisted.
- 8-12 câu hỏi tailored theo gap analysis giữa JD và CV mỗi ứng viên.

### Bước 5: Xuất báo cáo PDF
```
run_script("skills/candidate-evaluation/tools/generate_report.py", '{"document_ids": ["<jd_doc_id>"]}')
```
- Tổng hợp tất cả dữ liệu từ _state → xuất PDF.
- Trả về rendered_document_id (triggers download).

## Lưu ý
- Luôn chạy parse_jd trước, sau đó parse_cvs
- match_candidates yêu cầu đã có JD + candidates trong _state
- Có thể upload thêm CV bất kỳ lúc nào → parse_cvs sẽ merge
- **KHÔNG tự bịa dữ liệu** — chỉ dùng thông tin từ JD/CV thực tế
