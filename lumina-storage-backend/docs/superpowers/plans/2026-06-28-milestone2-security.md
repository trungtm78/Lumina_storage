# Milestone 2 — Security authz/IDOR (Phase 2) Implementation Plan

> Spec gốc: `~/.claude/plans/chu-n-h-a-l-i-to-n-serene-blanket.md` (Phase 2). Mỗi task STRICT: TDD(RED→GREEN) → full suite → /review(Claude) → /codex(diff) → fix tận gốc → commit. Cuối milestone: alignment vs spec + báo cáo Word.

**Goal:** Vá các lỗ hổng authz/IDOR đang sống TRƯỚC khi refactor chat/AI ở phase sau (refactor quanh lỗ hổng = nhân blast radius).

**Global constraints:** App luôn chạy; ≥142 tests passed (không regression); commit per task (Conventional Commits, không push); tái dùng `DocumentPermissionService` (không viết mới).

## Tasks

### Task 2.1: /tasks per-endpoint authz
- `tasks.py:20` POST /ping: thêm `current_user: CurrentUser` + `owner_id=current_user.id` khi dispatch.
- `tasks.py:92` GET /{task_id}: thêm `CurrentUser`; non-admin + `task.owner_id != current_user.id` → 404 (không lộ existence).
- Test: ẩn danh → 401; user B đọc task của A → 404; owner đọc được.

### Task 2.2: IDOR chat session ownership
- `chat_service.py` (get_history/get_messages/update_session/delete_session/send) + `chat.py:56-89,119`: lọc `ChatSession.user_id == current_user.id`; không khớp → 404.
- Test: user B không xem/sửa/xóa session của A → 404.

### Task 2.3: IDOR document_ids / SkillContext / candidate
- `chat_service.py:297` (stream_answer) + `:430,511` (stream_agent): validate quyền viewer từng document_id qua `DocumentPermissionService` trước khi search/attach.
- `skill_service.py:63` SkillContext.get_document_bytes: check_permission(viewer) bên trong.
- `candidate_evaluation.py:207,234,397`: truyền current_user + check quyền.
- Test: dùng doc ngoài quyền → bị loại/403.

### Task 2.4: Credential encryption atomic + migration
- `ai_model_config_service.py:75,164` + `storage.py:202`: `encrypt_value` khi lưu, `decrypt_value` khi đọc (di chuyển ĐỒNG THỜI write+read).
- `schemas/document.py:42`: redact raw `config` khỏi response.
- Alembic migration backfill: mã hóa row plaintext hiện có (idempotent, prefix enc:).
- Test: round-trip; giá trị DB không plaintext; mask UI vẫn hoạt động; migration idempotent.

### Task 2.5: Bỏ static /uploads + media compat
- `main.py:117-120`: bỏ `app.mount("/uploads")`.
- `upload.py:109,144,216`: chuyển trả document id / endpoint authz thay `/uploads/...` URL; chỉ unmount khi không còn caller (FE đã audit = 0 chỗ dùng).
- Test: `GET /uploads/<path>` → 404; download qua endpoint authz vẫn đúng quyền.

### Task 2.6: Password policy cho register
- `schemas/auth.py:7` RegisterRequest.password: field_validator (≥8, chữ+số) tái dùng từ ChangePasswordRequest.
- Test: tạo user mật khẩu yếu → 422.

### Task 2.7: Path traversal agent search_files
- `agent.py:338`: `(base_dir / path).resolve()` + `is_relative_to(base_dir.resolve())`, từ chối nếu thoát ra ngoài.
- Test: `path="../../.."` → bị chặn.

## Verify (milestone)
- Full suite xanh; security matrix (IDOR/path/password/credential); app healthy; `/uploads/<x>` 404.
- Alignment vs spec Phase 2 + báo cáo Word hoàn thành.
