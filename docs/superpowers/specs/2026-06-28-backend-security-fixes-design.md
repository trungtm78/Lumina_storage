# Spec — Khắc phục toàn diện Security & Correctness Backend (Lumina Storage)

- **Ngày:** 2026-06-28
- **Phạm vi:** Backend `lumina-storage-backend` (FastAPI). Không bao gồm frontend, infra, hay refactor tách file lớn (`review.py`/`generator.py`) — đó là các đợt riêng.
- **Nguồn:** Tổng hợp 2 lớp review — 5 agent Claude (kiến trúc/bảo mật/API-worker/FE/infra) + Codex (GPT, độc lập). Các phát hiện đã được verify bằng đọc code thật.
- **Mục tiêu chất lượng:** 10/10 — mỗi fix kèm test (TDD red→green), chạy full pytest suite, commit riêng từng mục để rollback an toàn.

## Quyết định đã chốt

1. **SECRET_KEY:** Tách thành 2 khóa env riêng — `SECRET_KEY` (chỉ ký JWT) và `ENCRYPTION_KEY` (chỉ mã hóa data). Không dùng chung gốc.
2. **Credential encryption:** Bọc `encrypt_value`/`decrypt_value` tại điểm ghi/đọc + alembic migration backfill mã hóa row plaintext hiện có (prefix `enc:` để nhận biết, idempotent).
3. **Static `/uploads`:** Bỏ hẳn `app.mount("/uploads")`. Đã audit: **frontend KHÔNG dùng `/uploads` ở bất kỳ đâu (0 chỗ)** → bỏ không phá vỡ FE. File phục vụ qua endpoint download có authz đã tồn tại.
4. **Quy trình:** `git init` đã thực hiện (baseline `f85d015`). Commit từng fix theo Conventional Commits, KHÔNG push.

## Danh mục fix — 14 mục, 3 phase

### PHASE 1 — Secrets & Crypto (nền tảng)

**1.1 — Guard SECRET_KEY ở startup**
- File: `src/core/config.py:11`, `main.py` (lifespan).
- Fix: trong `lifespan`/`create_app`, nếu `app_env == "production"` và `secret_key` thuộc tập placeholder (`changeme`, `your-secret-key-here`) hoặc độ dài < 32 → raise RuntimeError fail-closed. Môi trường dev chỉ log warning.
- Test: app raise khi production + placeholder; pass khi secret hợp lệ; dev chỉ warn.

**1.2 — Tách ENCRYPTION_KEY khỏi SECRET_KEY**
- File: `src/core/config.py`, `src/core/encryption.py:20`, `src/core/security.py:27`, `.env.example` (cả root và backend).
- Fix: thêm field `encryption_key` trong Settings; `encryption.py` derive Fernet key từ `encryption_key`; `security.py` giữ `secret_key` cho JWT. Fallback: nếu `encryption_key` trống, dev dùng `secret_key` (cảnh báo), production bắt buộc.
- Test: JWT vẫn verify được; Fernet round-trip dùng key mới.

**1.3 — Mã hóa credential khi lưu/đọc**
- File: `src/services/ai_model_config_service.py:75,164`, `src/services/storage_config.py:155`, `src/core/encryption.py:29`.
- Fix: bọc `encrypt_value()` trước khi persist `api_key`/S3 secret; `decrypt_value()` tại điểm sử dụng. Giá trị mã hóa prefix `enc:`; đọc thấy không có prefix coi là plaintext (tương thích ngược trong giai đoạn chuyển tiếp).
- Test: round-trip; giá trị lưu DB không phải plaintext; mask cho UI vẫn hoạt động.

**1.4 — Migration backfill mã hóa data cũ**
- File: `alembic/versions/<new>_encrypt_existing_credentials.py`.
- Fix: duyệt các row credential chưa có prefix `enc:` → mã hóa → ghi lại. Idempotent (chạy lại không double-encrypt). Downgrade: no-op (không giải mã ngược, document rõ).
- Test: row plaintext → sau migration có prefix `enc:` và giải mã đúng; chạy lần 2 không đổi.

### PHASE 2 — Authorization / IDOR

**2.1 — IDOR chat session** (`src/services/chat_service.py:180,217,233,442`; `src/api/v1/routes/chat.py:56,66,78,119`)
- Fix: mọi method (`get_history`, `update_session`, `delete_session`, `get_messages`, `send_message`) nhận `current_user` và truy vấn `WHERE id == session_id AND user_id == current_user.id`; không khớp → 404.
- Test: user B không xem/sửa/xóa được session của user A → 404.

**2.2 — IDOR document_ids qua chat→Qdrant** (`src/services/chat_service.py:297`, `src/services/vector_service.py:90`)
- Fix: trước khi search/attach, validate quyền `viewer` cho từng `document_id` người dùng truyền; loại ID không có quyền.
- Test: chat với `document_ids` của user khác → bị từ chối/loại khỏi context.

**2.3 — IDOR SkillContext.get_document_bytes** (`src/services/skill_service.py:63`)
- Fix: đưa `DocumentPermissionService.check_permission(..., viewer)` vào trong hàm, dùng identity của người gọi.
- Test: agent/tool đọc document ngoài quyền → ForbiddenError.

**2.4 — IDOR candidate routes** (`src/api/v1/routes/candidate_evaluation.py:207,234,397`)
- Fix: truyền `current_user`, check quyền cho mọi document ID nhận từ client.
- Test: candidate flow với ID ngoài quyền → 403.

**2.5 — /tasks không auth** (`src/api/v1/routes/tasks.py:20,92`)
- Fix: thêm `CurrentUser` cho `/tasks/ping` và `GET /tasks/{task_id}`; non-admin enforce `BackgroundTask.owner_id == current_user.id`.
- Test: user ẩn danh → 401; user thường đọc task người khác → 403/404.

**2.6 — Bỏ static /uploads** (`main.py:117`)
- Fix: xóa `app.mount("/uploads", StaticFiles(...))`. Bỏ `file_path` khỏi `DocumentResponse` (`src/schemas/document.py:87`) nếu không cần thiết cho FE (đã xác nhận FE không dùng). Phục vụ file chỉ qua `GET /documents/{id}/download` (đã có check quyền).
- Test: `GET /uploads/<path>` → 404; download qua endpoint authz vẫn hoạt động đúng quyền.

**2.7 — Password policy cho register/admin-set** (`src/schemas/auth.py:7`)
- Fix: thêm `field_validator` độ phức tạp (≥8, chữ + số) cho `RegisterRequest.password` và mọi đường admin set password; tái dùng hàm validate chung với `ChangePasswordRequest`.
- Test: tạo user mật khẩu yếu → 422.

**2.8 — Path traversal agent search_files** (`src/services/agent.py:338`)
- Fix: `(base_dir / path).resolve()` + kiểm tra `is_relative_to(base_dir.resolve())`, từ chối nếu thoát ra ngoài.
- Test: `path="../../.."` → bị từ chối, không liệt kê file ngoài skills.

### PHASE 3 — Correctness / Data integrity (rủi ro cao nhất, để cuối)

**3.1 — RAG ACL bỏ sót direct user-share** (`src/repositories/document.py:303,506`)
- Fix: `get_acl_only_ids()` truyền `user_id` vào `_build_acl_only_filter`; bỏ early-return khi `group_ids` rỗng.
- Test: document share trực tiếp cho user xuất hiện trong kết quả RAG của user đó.

**3.2 — Background task tái dùng request session** (`src/api/v1/routes/review.py:2763,2899,2904`)
- Fix: `_persist_eval_pdf` chỉ nhận ID, mở `AsyncSessionLocal` mới bên trong; không dùng lại session của request.
- Test: PDF persist thành công sau khi response đã trả; không race với cleanup.

**3.3 — Bỏ commit() trong service (Unit-of-Work)** (16 chỗ/7 file: `chat_service.py:147,230`, `skill_service.py:120`, `ai_model_config_service.py:103`, `document.py:439`, `agent.py:239`, `template_service.py:811`, `generator_template_service.py:871`...)
- Fix: đổi `db.commit()` → `db.flush()` khi cần ID; để `get_db` (`core/database.py:21`) commit cuối request. **Chạy full pytest sau MỖI file.**
- Test: thao tác đa-bước rollback nguyên tử khi lỗi giữa chừng (không còn dữ liệu nửa vời).

**3.4 — Thay except: pass bằng log** (35 chỗ: `chat_service.py:227`, `agent.py:467`, `generator.py:1031`, `review.py:562`...)
- Fix: thay `except Exception: pass` bằng `except <Specific>` + `logger.warning(..., exc_info=True)`. Chỉ giữ "best-effort" khi thực sự an toàn và phải log.
- Test: lỗi trong nhánh được log thay vì nuốt im lặng (kiểm qua caplog).

## Chiến lược test

- Dùng pytest có sẵn (`conftest.py`, asyncio auto, fixtures permission/user).
- Mỗi fix: viết test ĐỎ trước → fix → XANH → chạy full suite → commit.
- Test IDOR theo mẫu chung: tạo 2 user + resource của user A → user B truy cập → assert từ chối.
- Phase 3.3 (commit boundary) rủi ro nhất: full suite sau mỗi file đã sửa.

## Thứ tự thực hiện & checkpoint

1. Phase 1 (1.1→1.4) — nền tảng crypto, độc lập.
2. Phase 2 (2.1→2.8) — authz, mỗi mục độc lập, giá trị cao.
3. Phase 3 (3.1→3.4) — correctness, rủi ro cao, để cuối; 3.3 cẩn trọng nhất.

Mỗi mục = 1 commit Conventional Commits (`fix(security): ...` / `fix(correctness): ...`). KHÔNG push.

## Rủi ro & giảm thiểu

- **`/uploads`:** đã audit FE = 0 chỗ dùng → bỏ an toàn. (Rủi ro đã loại bỏ.)
- **`ENCRYPTION_KEY` đổi → mất giải mã credential:** document rõ trong `.env.example`; migration backfill chạy 1 lần; không rotate tùy tiện.
- **Commit boundary (3.3):** có thể vỡ flush/refresh → full test sau mỗi file; để cuối cùng; nếu test vỡ khó sửa, có thể giữ commit ở service nhưng gói trong savepoint (phương án dự phòng).
- **Migration trên DB đang chạy:** chạy qua container `migrate`; backfill idempotent nên an toàn chạy lại.

## Ngoài phạm vi (đợt sau)

- Tách `review.py` (3734 dòng) / `generator.py` (2332 dòng) thành service layer.
- Frontend: code-splitting, DOMPurify cho `dangerouslySetInnerHTML`, chia page khổng lồ.
- Infra: CI/CD (ruff + pytest + trivy), readiness healthcheck, structured logging, admin password mặc định.
- Blocking event loop (generator/ops `to_thread`), Qdrant timeout/circuit-breaker, race condition dedupe job — correctness mức High nhưng không thuộc nhóm "lỗ hổng" của đợt này; cân nhắc gộp nếu muốn mở rộng.
