# Candidate Evaluation

Tài liệu mô tả chi tiết tính năng **Đánh giá ứng viên theo Job Description** trên Lumina Storage.

---

## 1. Feature name

**Candidate Evaluation** — Đánh giá ứng viên theo Job Description (No-Prompt UI).

Luồng wizard 5 bước, phân tích JD và CV bằng LLM, chấm điểm + xếp hạng, sinh câu hỏi phỏng vấn, và xuất báo cáo PDF.

---

## 2. Link domain

| Môi trường | URL |
|---|---|
| Local dev | `http://localhost:5173/candidate-evaluation` |
| Staging | _<cập nhật khi deploy>_ |
| Production | _<cập nhật khi deploy>_ |

Route: `/candidate-evaluation` (protected — yêu cầu đăng nhập).

Backend API base: `/api/v1/candidate-evaluation` (xem mục 6).

---

## 3. Scope + Expected behavior

### In scope

- Upload 1 JD (PDF / DOCX / TXT) → parse thành dữ liệu có cấu trúc (title, skills, responsibilities, experience, education, …).
- Upload tới **50 CV** cùng lúc → parse song song.
- Chấm điểm & xếp hạng: 3 trục — **Chuyên môn / Kỹ năng mềm / Kinh nghiệm**, tổng 0–100.
- Shortlist top N (1–50, mặc định 5).
- Sinh câu hỏi phỏng vấn cá nhân hoá theo JD + CV + kết quả chấm điểm (tối đa 20 ứng viên/lần).
- Xuất báo cáo PDF gộp toàn bộ thông tin + preview inline.
- PDF được render qua Gotenberg, ghi vào storage backend như document `source_type="skill_temp"` (ẩn khỏi Documents list); user truy cập qua `rendered_document_id` cho nút "Xem" / "Tải".

### Out of scope (hiện tại)

- Không lưu lịch sử các phiên đánh giá — state chỉ tồn tại trong session trình duyệt.
- Không có tính năng so sánh ứng viên ngang hàng (side-by-side).
- Không gửi email / thông báo tới ứng viên.
- Không hỗ trợ multi-user collaboration real-time.

### Expected behavior

- Mỗi bước phải hoàn thành mới unlock bước kế tiếp (ví dụ: không có JD thì không mở được Upload CV).
- Có thể quay lại bước trước để chỉnh sửa; state các bước sau không bị clear nếu JD/CV không thay đổi.
- Khi 1 CV parse lỗi → bỏ qua CV đó, vẫn tiếp tục các CV khác; báo `failed_count` + `failed_document_ids`.
- Khi toàn bộ CV đều fail → trả error tường minh, không vào bước chấm điểm.
- LLM call thất bại với 1 ứng viên trong batch → ứng viên đó nhận `score_error`, `total_score=null`, recommendation `error`, bị đẩy xuống cuối shortlist (không lẫn vào top).
- PDF preview tự abort sau 60s nếu generate quá lâu.
- Input gắn giới hạn để chặn DoS + blow past LLM token budget (xem mục 6).

---

## 4. Flow diagram / User flow

```
┌─────────────────────────────────────────────────────────────────┐
│  User navigates to /candidate-evaluation                        │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 1 · Job Description                                       │
│  • Upload JD (PDF/DOCX/TXT) hoặc chọn từ Storage                │
│  • Click "Phân tích JD" → POST /parse-jd                        │
│  • Hiển thị kết quả parse, cho phép chỉnh sửa inline            │
└────────────────────────────────┬────────────────────────────────┘
                                 │ (JD parsed)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 2 · Upload CV                                             │
│  • Drag & drop ≤ 50 CV hoặc chọn từ Storage                     │
│  • Click "Bóc tách N CV" → POST /parse-cvs (song song)          │
│  • Hiển thị danh sách ứng viên đã parse                         │
└────────────────────────────────┬────────────────────────────────┘
                                 │ (candidates ready)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 3 · Xếp hạng                                              │
│  • Chọn Top N hoặc All                                          │
│  • Click "Chấm điểm & Xếp hạng" → POST /match                   │
│  • Hiển thị bảng: Tổng điểm / Chuyên môn / Kỹ năng mềm /        │
│    Kinh nghiệm / Đánh giá (Rất phù hợp → Không phù hợp)         │
└────────────────────────────────┬────────────────────────────────┘
                                 │ (rankings ready)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 4 · Phỏng vấn                                             │
│  • Click "Tạo câu hỏi phỏng vấn" → POST /generate-questions     │
│  • Sinh 10–15 câu/ứng viên, chia 5 nhóm:                        │
│    Kỹ thuật · STAR · Tình huống · Kinh nghiệm & Dự án · Chuyên  │
│    môn                                                          │
│  • Tab chuyển giữa các ứng viên; mỗi câu có mục đích + follow-up│
└────────────────────────────────┬────────────────────────────────┘
                                 │ (questions ready)
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 5 · Báo cáo                                               │
│  • Click "Xuất báo cáo PDF" → POST /generate-report             │
│  • Backend render HTML → PDF, lưu vào Storage                   │
│  • "Xem" → inline iframe preview (abort sau 60s)                │
│  • "Tải báo cáo PDF" → download trực tiếp                       │
└─────────────────────────────────────────────────────────────────┘
```

**State transitions:** State lưu trong React state của page component; chuyển bước không mất dữ liệu; reload trang sẽ reset.

---

## 5. User guide

### Bước 1 — Upload & phân tích JD

1. Vào **Candidate Evaluation** từ sidebar trái.
2. Kéo thả file JD hoặc click **Chọn file** (hỗ trợ PDF, DOCX, TXT). Có thể click **Từ Storage** để chọn document đã có.
3. Click **Phân tích JD** — đợi ~15–30s.
4. Kiểm tra kết quả: vị trí, địa điểm, hình thức, loại hợp đồng, kinh nghiệm, học vấn, chuyên ngành ưu tiên, hard skills (bắt buộc / ưu tiên), soft skills.
5. Có thể chỉnh sửa inline nếu LLM parse chưa chính xác (thêm/xoá skill, đổi level…).
6. Click **Tiếp theo**.

### Bước 2 — Upload & bóc tách CV

1. Kéo thả tối đa **50 CV** hoặc **Từ Storage**.
2. Click **Bóc tách N CV** — thời gian ~10–20s cho mỗi 5 CV (parse song song).
3. Kiểm tra danh sách ứng viên đã parse (tên, role, công ty, năm KN, skills, học vấn, địa điểm).
4. Nếu có CV fail → UI sẽ hiển thị `failed_count` và danh sách document ID bị lỗi. Có thể xoá hoặc upload lại.
5. Click **Tiếp theo**.

### Bước 3 — Chấm điểm & xếp hạng

1. Chọn **Top N** (3 / 5 / 10) hoặc **All**.
2. Click **Chấm điểm & Xếp hạng** — ~30–60s tuỳ số lượng ứng viên.
3. Xem bảng xếp hạng với 3 trục điểm; click vào 1 ứng viên để xem chi tiết strengths/gaps/recommendation.
4. Click **Tiếp theo**.

### Bước 4 — Sinh câu hỏi phỏng vấn

1. Mặc định sinh cho toàn bộ shortlist (có thể chọn lọc lại).
2. Click **Tạo câu hỏi phỏng vấn** — ~20–40s/ứng viên, chạy song song tối đa 5 ứng viên.
3. Chuyển tab giữa các ứng viên để xem câu hỏi của từng người.
4. Mỗi câu hỏi đi kèm: **Mục đích**, **Follow-up**, gợi ý **câu trả lời tốt**.
5. Click **Tiếp theo**.

### Bước 5 — Xuất báo cáo

1. Xem tổng kết (số ứng viên / đã xếp hạng / có câu hỏi PV).
2. Click **Xuất báo cáo PDF** — ~30–60s.
3. Sau khi render xong:
   - **Xem** → mở inline preview (iframe), fetch qua `rendered_document_id`.
   - **Tải báo cáo PDF** → download trực tiếp qua `rendered_document_id`.

---

## 6. API reference (tóm tắt)

Base path: `/api/v1/candidate-evaluation` · Tất cả yêu cầu `Authorization: Bearer <token>`.

| Method | Endpoint | Body chính | Giới hạn |
|---|---|---|---|
| POST | `/parse-jd` | `document_id`, `model_id?` | 1 JD/lần |
| POST | `/parse-cvs` | `document_ids[]`, `jd`, `existing_candidates[]`, `model_id?` | ≤ 50 CV/lần, ≤ 200 candidate hiện có |
| POST | `/match` | `jd`, `candidates[]`, `top_n`, `model_id?` | ≤ 100 candidate, top_n ∈ [1,50] |
| POST | `/generate-questions` | `jd`, `candidates[]`, `rankings[]`, `shortlist_indices[]`, `candidate_indices?`, `model_id?` | ≤ 20 candidate sinh câu hỏi |
| POST | `/generate-report` | `jd`, `candidates[]`, `rankings[]`, `interview_questions`, `jd_document_id`, `top_n`, `model_id?` | ≤ 100 candidate |

Chi tiết schema xem [api/candidate_evaluation.md](../api/candidate_evaluation.md) _<tạo khi cần>_ hoặc đọc trực tiếp `src/api/v1/routes/candidate_evaluation.py`.

---

## 7. Known issues / Lưu ý

### Lưu ý vận hành

- **LLM latency.** Chạy end-to-end 3 CV hết ~2–3 phút. Với 20+ CV nên cảnh báo user thời gian chờ.
- **Token budget.** Candidate list lớn + JD dài dễ chạm context window của model. Giới hạn 100/lần là cứng.
- **Prompt injection.** Mọi dữ liệu từ JD / CV đều wrap trong `<untrusted_data>` + có `INJECTION_GUARD` trong system prompt. Nếu đổi model, verify lại guard.
- **State tạm.** Reload trang mất toàn bộ tiến trình — sẽ cân nhắc persist khi có nhu cầu.
---

_Last updated: 2026-04-23_
