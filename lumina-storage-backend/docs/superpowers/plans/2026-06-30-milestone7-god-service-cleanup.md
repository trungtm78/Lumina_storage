# Phase 7 — God-service cleanup (agent.py + chat_service.py) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Mỗi task STRICT: TDD (RED→GREEN) → full suite → critique outside-voice → fix → commit (Conventional Commits, KHÔNG push).
> Spec gốc §Phase 7: `~/.claude/plans/chu-n-h-a-l-i-to-n-serene-blanket.md` (line 73).

## Context

`agent.py` (752 dòng) là god-service: truy vấn SQL THẲNG (`sa_text`) bỏ qua repository, `write_file` tự dựng Document (không ACL, không qua DocumentService), nhiều `except: pass` nuốt lỗi. `chat_service.py` (782 dòng) trộn 5 trách nhiệm + còn hàm CHẾT `stream_answer` (~140 dòng, route đã chuyển sang `stream_agent`). Phase 7: (a) thay sa_text bằng repo/service; (b) `write_file` → `DocumentService.create_from_bytes` + ACL; (c) gỡ bare-except (log + cụ thể); (d) bắt đầu tách `chat_service.py` — XÓA dead `stream_answer` + trích `CitationService` (an toàn nhất, test sẵn). Pure refactor: hành vi KHÔNG đổi (trừ bare-except giờ LOG); full suite xanh nguyên + import-linter xanh.

**Inventory (agent-verified):**
- **sa_text agent.py (6):** `write_file:247` (`SELECT id FROM storage_storageconfig LIMIT 1`), `run_script:489` (`SELECT value FROM core_systemconfig WHERE key='skill_model_config'`), `list_directory:318` + `search_files:355` + `search_templates:598` (`documents_document` owner-only ILIKE). → repo.
- **write_file god-func (221-280):** raw storage config + tự dựng Document + commit cố ý + `except Exception: return error`. KHÔNG ACL, KHÔNG folder.
- **bare-except agent.py (4):** `504` (skill_model_config), `520` (vendor config.json), `530` (app_config decrypt), `278` (write_file). → log + cụ thể.
- **chat_service.py:** dead `stream_answer` (376-517, route `chat.py:144` dùng `stream_agent`) → XÓA. Trích **CitationService** = `_coerce_uuid`+`citation_to_source`+`citations_to_sources` (92-137, ~50 dòng; test_citation_phase4.py 6 test; 0 phụ thuộc ngược). KHÔNG raw SQL, KHÔNG service→api (sạch sau P6).
- **TOOLS=[rag_search]** (671): các @tool khác (write_file/list_directory/...) decorated nhưng CHƯA wire vào create_agent; chat_service import vài cái. Vẫn dọn theo spec (giữ khả năng wire lại).

## Global Constraints

- Test từ ROOT `c:\Lumina_Storage`: `docker compose --profile test run --rm test uv run pytest <path> -q`. Baseline **369 passed**, import-linter 2 kept 0 broken.
- **PURE REFACTOR** — KHÔNG đổi hành vi/response (trừ bare-except giờ LOG warning). Full suite + import-linter xanh nguyên. Comment tiếng Việt; commit per task, KHÔNG push.
- **GIỮ NGUYÊN semantics sa_text**: query document owner-only (owner_id + exclusions + ILIKE) → repo method owner-only CHÍNH XÁC, KHÔNG đổi sang get_accessible_paginated (sẽ broaden ACL = behavior change). storage→get_default, systemconfig→get_by_key (semantics khớp).
- **write_file commit CỐ Ý** (Phase 3): side-effect tool phải bền ngay → create_from_bytes (no-commit) + `await db.commit()` ở write_file giữ nguyên.
- Mỗi task STRICT (TDD→suite→critique→fix→commit). import-linter phải vẫn xanh (agent.py là service → KHÔNG import api).

## What already exists (tái dùng)

- `StorageConfigRepository.get_default()`, `SystemConfigRepository.get_by_key(key)`, `DocumentRepository` (`src/repositories/document.py`, `system.py`).
- `DocumentService` (`src/services/document.py`): `_resolve_storage`, `upload_files` (ACL qua perm_svc.check_permission), `DocumentPermissionService`.
- `tests/test_citation_phase4.py` (6 test citation), `test_golden_chat_phase4.py` (e2e stream_agent), `test_chat_*` (idor/uow).

## File Structure

- Create: `src/services/citation_service.py` (move 3 hàm citation). `tests/services/test_agent_repo_cleanup.py` (sa_text→repo characterization) + bổ sung test write_file.
- Modify: `src/services/agent.py` (sa_text→repo, write_file→DocumentService, bare-except→log); `src/services/document.py` (thêm `create_from_bytes`); `src/repositories/document.py` (thêm `list_owned` nếu cần); `src/services/chat_service.py` (xóa dead stream_answer + import CitationService); `tests/test_citation_phase4.py` (đổi import sang citation_service).

---

### Task 1: sa_text → repo trong agent.py (giữ nguyên semantics)

**Files:** Modify `agent.py` (run_script:489 systemconfig; list_directory:318/search_files:355/search_templates:598 documents); `src/repositories/document.py` (+`list_owned` owner-only). Test `tests/services/test_agent_repo_cleanup.py`.

**3 repo method RIÊNG (critique P0#1: 3 query semantics KHÁC nhau — KHÔNG gộp 1 method):**
```python
# search_files:355 — exclude CHỈ skill_temp, ILIKE(title,original_filename), LIMIT 10, q bắt buộc
async def search_workspace_files(self, user_id, q, limit=10) -> list[Document]
# list_directory:318 — exclude skill_temp+template, extension dual (.docx+docx), ILIKE optional, LIMIT 20
async def list_workspace_files(self, user_id, *, extensions=None, q=None, limit=20) -> list[Document]
# search_templates:598 — source_type='template', ILIKE(title,description,original_filename), LIMIT 5
async def search_owned_templates(self, user_id, q, limit=5) -> list[Document]
```
Mỗi method = 1 select SQLAlchemy DSL khớp CHÍNH XÁC WHERE/ILIKE/ORDER/LIMIT của raw cũ. run_script:489 → `SystemConfigRepository(db).get_by_key("skill_model_config")` (đọc `.value`).

- [ ] **Step 1 RED** test_agent_repo_cleanup: 1 test/method — exclude set đúng, extension dual-expansion (.docx+docx), ILIKE cột đúng (templates có description), order updated_at desc, limit; systemconfig get_by_key trả value.
- [ ] **Step 2-3 GREEN** thêm 3 method; thay 3 sa_text document + 1 systemconfig; bỏ `sa_text` import nếu hết (write_file storage ở T2).
- [ ] **Step 4** full suite + import-linter. **Step 5 commit** `refactor(agent): sa_text→repo (documents owner-only + systemconfig) (T1 P7)`.

---

### Task 2: write_file → DocumentService.create_from_bytes + ACL

**Files:** `src/services/document.py` (+`create_from_bytes`); `agent.py` write_file (gọi service + giữ commit cố ý). Test `tests/services/test_document_create_from_bytes.py`.

**`DocumentService.create_from_bytes`** (gói tạo Document từ bytes, dùng chung skill/agent):
```python
async def create_from_bytes(self, *, data, filename, owner, folder_id=None,
                            mime_type=None, source_type="skill_generated") -> DocumentResponse:
    if folder_id:  # ACL chỉ khi có folder (write_file hiện root → không đổi hành vi)
        folder = await self.folder_repo.get_by_id_active(folder_id)
        if not folder: raise NotFoundError(...)
        await self.perm_svc.check_permission(owner, folder_id=folder_id, required="editor")
    storage_config, backend = await self._resolve_storage(None, owner)
    save = await backend.save(data, filename)
    doc = await self.doc_repo.create({... owner_id, source_type, mime_type or guess, ...})
    return DocumentResponse.model_validate(doc)
```
write_file else-branch: `doc = await DocumentService(deps.db).create_from_bytes(data=data, filename=filename, owner=deps.user, mime_type="text/plain", source_type="skill_generated"); doc_id = doc.id; await deps.db.commit()`. create_from_bytes KHÔNG commit (chỉ repo.create flush+refresh, như upload_files) → write_file commit MỘT lần (critique P1#3, không double-commit). DocumentService(deps.db) tạo per-call (rẻ, như pattern hiện có — critique P2#10).

**Critique P0#2 — DOCUMENTED behavior alignment:** write_file:247 cũ `SELECT id FROM storage_storageconfig LIMIT 1` (config ĐẦU TIÊN) → create_from_bytes dùng `_resolve_storage`→`get_default()` (is_default=True). KHÁC khi KHÔNG có config is_default (cũ lấy bừa, mới raise BadRequestError). CHẤP NHẬN: write_file giờ NHẤT QUÁN với mọi upload thật (đó là MỤC ĐÍCH Phase 7); production luôn seed default (test fixture set is_default=True). Ghi rõ ở report.

- [ ] **Step 1 RED** test_document_create_from_bytes: tạo doc owner-only root (storage default) → đọc lại được, owner_id/source_type đúng; folder_id không có quyền → ForbiddenError (ACL).
- [ ] **Step 2-3 GREEN** create_from_bytes + rewire write_file (giữ commit). storage_storageconfig sa_text biến mất.
- [ ] **Step 4** full suite + import-linter. **Step 5 commit** `refactor(agent): write_file → DocumentService.create_from_bytes + ACL (T2 P7)`.

---

### Task 3: gỡ bare-except agent.py (log + cụ thể)

**Files:** `agent.py` (504/520/530 + write_file 278). Test: assert log phát ra (caplog) khi config lỗi.

**Critique P1#7 — GIỮ catch BROAD + LOG (KHÔNG thu hẹp):** mục tiêu spec = gỡ SILENT swallow (`except: pass`), KHÔNG phải bắt hẹp. Thu hẹp sang type cụ thể → exception khác (SQLAlchemyError/OSError/...) sẽ ESCAPE = crash MỚI. Giữ `except Exception as e: logger.warning(...,exc_info=True)` rồi fall-through (no-crash giữ nguyên, chỉ thêm log).

- [ ] **Step 1 RED** test (caplog): skill_model_config raise → log warning + fallback (không im lặng); write_file lỗi → log error + trả JSON error (không crash).
- [ ] **Step 2-3 GREEN** 504/520/530: `except Exception as e: logger.warning("... %s", e, exc_info=True)` (BROAD, fall-through); write_file:278: `except Exception as e: logger.error(...); return json error` (giữ tool-boundary isolation).
- [ ] **Step 4** full suite. **Step 5 commit** `refactor(agent): gỡ except:pass → log + bắt cụ thể (T3 P7)`.

---

### Task 4: chat_service.py — xóa dead stream_answer + trích CitationService

**Files:** Create `src/services/citation_service.py`; Modify `chat_service.py` (xóa stream_answer 376-517 + 3 hàm citation → import từ citation_service); `tests/test_citation_phase4.py` (đổi import).

- [ ] **Step 1** XÓA `stream_answer` (376-517, dead — route dùng stream_agent; xác minh `grep stream_answer src/` chỉ còn định nghĩa). Full suite xanh (chứng minh dead).
- [ ] **Step 2 RED→GREEN** tạo citation_service.py (move `_coerce_uuid`/`citation_to_source`/`citations_to_sources`); chat_service import từ đó (xóa bản cũ); test_citation_phase4 đổi import `from src.services.citation_service import ...`.
- [ ] **Step 3** full suite (6 test citation + golden chat e2e xanh) + import-linter.
- [ ] **Step 4 commit** `refactor(chat): xóa dead stream_answer + trích CitationService (T4 P7)`.

---

### Task 5: Checkpoint Phase 7

- [ ] Full suite + smoke (app boot, worker import, agent import) + import-linter 2 kept 0 broken.
- [ ] grep agent.py: `sa_text`/`text(` = 0 (hoặc chỉ chỗ hợp lý); `except:`/`except Exception: pass` = 0.
- [ ] Alignment audit đối chiếu spec Phase 7. Báo cáo Word `docs/Lumina_Storage_Milestone7_*.docx`.
- [ ] Commit `test(cleanup): checkpoint Phase 7`.

## NOT in scope (Phase 8)

- Tách `review.py`(3734)/`generator.py`(2332) route khổng lồ → service+ai; module hóa `domain/<x>/`; worker DLQ + race dedupe.
- Trích nốt Concern B (ChatPermissionService) / D (TitleService) / E (stream_agent) khỏi chat_service — Phase 7 chỉ "bắt đầu tách" (CitationService + xóa dead).
- Wire lại 7 @tool chưa dùng vào TOOLS (design question — giữ nguyên).

## Verification

1. `docker compose --profile test run --rm test uv run pytest -q` — full suite xanh (369+, pure refactor).
2. `uv run lint-imports` — 2 kept, 0 broken (agent.py/citation_service không phá layering).
3. grep agent.py: 0 `sa_text`, 0 `except Exception: pass`. grep `stream_answer src/`: chỉ 0 (đã xóa).
4. Smoke: app boot + worker + `from src.services.agent import build_model` + `from src.services.citation_service import citations_to_sources` OK.
5. Báo cáo Word Milestone 7.

## Rủi ro & Rollback

- sa_text→repo đổi semantics (owner-only vs ACL): GIỮ owner-only chính xác qua list_owned (characterization test pin hành vi). write_file ACL chỉ kích hoạt khi folder_id (hiện root → không đổi).
- create_from_bytes commit: write_file giữ commit cố ý (side-effect bền ngay).
- CitationService: pure move, test sẵn. stream_answer: xác minh dead (grep route) trước khi xóa.
- Rollback: git revert từng task.

## GSTACK REVIEW REPORT (outside-voice critique — đã resolve)

- **P0#1 (list_owned gộp sai semantics):** RESOLVED — 3 method RIÊNG (search_workspace_files exclude skill_temp; list_workspace_files exclude skill_temp+template+extension-dual; search_owned_templates source_type=template+ILIKE-description). 1 characterization test/method.
- **P0#2 (LIMIT-1 → get_default behavior change):** ACCEPTED + DOCUMENTED — write_file dùng _resolve_storage/get_default = nhất quán với upload thật (mục đích Phase 7); production luôn có default; ghi rõ ở report.
- **P1#3 (commit race):** RESOLVED — create_from_bytes no-commit (repo.create flush+refresh như upload_files); write_file commit 1 lần; doc_id từ DocumentResponse đã refresh.
- **P1#4 (stream_answer dead):** CONFIRMED — chỉ route chat.py:144 dùng stream_agent; xác minh grep src/+tests/ trước khi xóa.
- **P1#5 (CitationService circular):** SAFE — citation_service chỉ cần Citation type + stdlib; không import ngược; đổi import test_citation_phase4.
- **P1#6 (import-linter):** SAFE — agent.py/citation_service không import api; verify 2 kept sau mỗi task.
- **P1#7 (bare-except crash mới):** RESOLVED — GIỮ `except Exception` BROAD + logger.warning(exc_info) (không thu hẹp type); chỉ thêm log, no-crash giữ nguyên.
- **P2#8 (write_file:278):** RESOLVED — giữ except Exception (tool isolation) + thêm logger.error.
- **P2#10 (DocumentService instance):** RESOLVED — DocumentService(deps.db) per-call trong write_file.
