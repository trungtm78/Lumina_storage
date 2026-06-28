# Milestone 3 — Unit of Work + Commit Boundary (Phase 3) Implementation Plan

> Spec gốc: `~/.claude/plans/chu-n-h-a-l-i-to-n-serene-blanket.md` (Phase 3, dòng 54). Mỗi task STRICT: TDD(RED→GREEN) → full suite → /review(Claude) → /codex(diff) → fix tận gốc → commit. Cuối milestone: alignment vs spec + báo cáo Word.

**Goal (spec):** `core/uow.py` + `get_uow`; MỘT contract commit/rollback cho cả HTTP và ARQ; gỡ commit rải rác ở service + route + worker theo từng domain. **Done:** test "lỗi giữa chừng → rollback toàn bộ" xanh mỗi domain; không còn partial-commit ở route/worker.

## Hiện trạng (đã khảo sát — 75 commit sites)

- **HTTP:** `core/database.py:get_db()` ĐÃ auto-commit cuối request (commit nếu ok, rollback nếu exception). Nhưng **service tự commit giữa chừng** (chat_service ×6, ai_model_config ×4, skill_service ×2, document ×1, agent ×1) + **route tự commit** (generator ×13, review ×7, templates ×6) → nếu lỗi sau một commit giữa chừng, phần đã commit KHÔNG rollback được = **partial-commit**.
- **ARQ:** `worker/context.py` tạo `session_factory` global; mỗi task `async with session_factory() as db:` rồi commit rải rác. `document.py ingest` có 15 commit, gồm **checkpoint status** (mark running/error/success) PHẢI commit độc lập để UI thấy tiến độ + ghi lỗi sau khi rollback business data.
- **BaseRepository:** flush-only ✓ (giữ nguyên). Chưa có UoW.

## Nguyên tắc thiết kế

1. **Một transaction = một logical operation.** Business mutation gom vào MỘT commit boundary; bỏ commit giữa chừng ở service/route.
2. **Checkpoint status là transaction RIÊNG, cố ý.** Worker mark running/error/success KHÔNG nằm trong transaction business (phải sống sót qua rollback business). UoW phải hỗ trợ "commit status ngắn" tách khỏi "transaction business".
3. **HTTP boundary = get_uow** (thay get_db dần, hoặc get_db ủy quyền cho UoW). ARQ boundary = `uow_context(session_factory)`.
4. **Incremental theo domain, app luôn chạy, test xanh sau mỗi commit.** Không big-bang 75 site một lần.

## Thiết kế `core/uow.py`

```python
class UnitOfWork:
    """Bao một AsyncSession; commit khi thoát sạch, rollback khi có exception.
    Repository/service chỉ flush; UoW là nơi DUY NHẤT commit business data."""
    def __init__(self, session: AsyncSession): self.session = session
    async def __aenter__(self) -> "UnitOfWork": return self
    async def __aexit__(self, exc_type, *_):
        if exc_type: await self.session.rollback()
        else: await self.session.commit()
    async def commit(self): await self.session.commit()      # cho checkpoint cố ý
    async def rollback(self): await self.session.rollback()
    async def flush(self): await self.session.flush()
```

- **HTTP:** `get_uow` (FastAPI dependency) yield `UnitOfWork(session)` từ cùng session của `get_db`; commit một lần ở cuối. Giai đoạn chuyển tiếp: giữ `get_db` auto-commit (idempotent với UoW vì cùng session) để không phải đổi mọi route cùng lúc — chỉ cần GỠ commit trong service/route, boundary cuối request vẫn commit. (Quyết định: KHÔNG đổi chữ ký mọi route ngay; chỉ centralize commit. Xem "Câu hỏi mở".)
- **ARQ:** `uow_context(session_factory)` = async context manager tạo session + UnitOfWork; task dùng `async with uow_context(...) as uow:` cho business; status checkpoint dùng `uow.commit()` cố ý hoặc session riêng ngắn.

## Tasks (mỗi task STRICT, theo domain)

### Task 3.1: `core/uow.py` + `get_uow` + helper ARQ + test nền
- Tạo `UnitOfWork`, `get_uow` (dependency dùng lại session get_db), `uow_context` cho worker.
- Test: commit khi thoát sạch; rollback khi raise; `commit()` thủ công flush ra DB; lồng ghép với savepoint của conftest không vỡ.
- KHÔNG đổi call site nào ở task này (chỉ hạ tầng).

### Task 3.2: Domain AI Model Config (đơn giản nhất — làm mẫu)
- Gỡ 4 `self.db.commit()` trong `ai_model_config_service.py`; commit về boundary (get_db cuối request / get_uow).
- Test: tạo config rồi raise giữa chừng (mock lỗi sau create) → KHÔNG còn row (rollback toàn bộ). Happy path vẫn 201 + persisted.

### Task 3.3: Domain Chat
- Gỡ commit ở `chat_service.py` (create_session/delete/update/create_message/create_message_with_skill_result) + `agent.py:257` save_document_tool. `_generate_title_background:84` tạo session riêng (background) → giữ commit riêng (ngoài request scope) NHƯNG bọc bằng `uow_context`.
- Test: lỗi giữa chừng khi tạo message + sources → rollback cả message lẫn sources.

### Task 3.4: Domain Generator + Template
- Gỡ commit ở route `generator.py` (×13) + `templates.py` (×6) + `template_service.py:811` + `generator_template_service.py:871` + `skill_service.py` (×2). Chuyển business mutation về boundary.
- Cẩn thận các route có nhiều commit nested (generate_from_session, delete_session) — gộp thành một transaction.
- Test: lỗi giữa chừng generate_from_session → không partial (session/version/render nhất quán).

### Task 3.5: Domain Review + Document(service)
- Gỡ commit route `review.py` (×7) + `document.py:439` soft_delete_template_docs.
- Test: lỗi giữa chừng save_version/start_review → rollback.

### Task 3.6: Worker — document ingest + các task khác (khó nhất)
- `worker/tasks/document.py`: tách RÕ 2 loại:
  - **Checkpoint status** (running/error/success ở `:83,146,372,381,396,444,464,489,498,509,573` + dispatch `:51`): commit độc lập (transaction ngắn) — phải sống sót qua rollback business + ghi được lỗi.
  - **Business mutation** (ghi document fields + chunks `:334,345`, cleanup `:554`): bọc trong `uow_context` một transaction; lỗi → rollback business, rồi mark error ở transaction status riêng.
- Các task khác: `thumbnail.py:47`, `agent_state_cleanup.py:44`, `skill_cleanup.py:64`, `demo.py` → bọc `uow_context` (giữ checkpoint nếu có).
- Test: ingest lỗi giữa chừng (mock extract/upsert raise) → business rollback NHƯNG status='failed' vẫn được ghi (checkpoint riêng). Đây là bất biến quan trọng nhất của Phase 3.

### Checkpoint M3
- Full suite xanh; smoke E2E (login→upload→ingest→chat→generator) chạy.
- Quét đảm bảo KHÔNG còn `.commit()` ở route/worker business path (chỉ còn ở boundary + checkpoint status cố ý, có comment lý do).
- `/plan-eng-review` alignment vs spec Phase 3 + báo cáo Word.

## Test & Verify
- Mỗi domain: 1 test "rollback toàn bộ khi lỗi giữa chừng" (bất biến Done của spec) + happy path không regression.
- Worker ingest: test checkpoint status sống sót qua business rollback.
- Full pytest (conftest savepoint) sau mỗi task; baseline hiện tại **180 passed**.

## Rủi ro & Rollback
- **Conftest savepoint** (`join_transaction_mode="create_savepoint"`) + UoW.commit() trong test: commit thật bị chặn bởi outer transaction rollback của fixture → an toàn, nhưng cần đảm bảo UoW không gọi `begin()` mới làm vỡ savepoint. Test 3.1 kiểm điều này sớm.
- **Background/worker session riêng:** không được dùng request session; giữ `uow_context(session_factory)` riêng.
- **Checkpoint status:** nếu gộp nhầm vào business transaction → mất khả năng báo 'failed' khi business lỗi. Test 3.6 chốt.
- Rollback mặc định: `git revert` từng task (tag `pre-refactor`); mỗi domain 1 commit.

## Quyết định đã chốt (từ /plan-eng-review 2026-06-28)
1. **Scope = TỐI THIỂU:** giữ `get_db()` auto-commit làm HTTP boundary; CHỈ gỡ commit rải rác ở service/route; thêm `get_uow` + `uow_context` cho worker và code mới. KHÔNG đổi chữ ký mọi route sang `Depends(get_uow)` (tránh blast radius/regression). get_uow sẵn sàng cho phase sau.
2. **Enqueue ordering = COMMIT TRƯỚC ENQUEUE (tường minh):** trong mọi flow có `enqueue_job`/`dispatch_task`, gọi `uow.commit()` (hoặc commit boundary) NGAY TRƯỚC khi enqueue → tách 2 transaction: (a) ghi data + commit, (b) enqueue. Bảo đảm worker luôn thấy data, không race "Document not found". Đây là bất biến BẮT BUỘC khi gỡ commit ở route có enqueue (vd `documents.py:131-135` upload: commit doc TRƯỚC `enqueue_job`/`dispatch_task`).
3. **Thứ tự domain:** AI config (mẫu) → chat → generator/template → review/document → worker. Worker cuối vì khó nhất.

## Test bổ sung (bắt buộc — regression rule)
- **Enqueue-ordering test (per flow có enqueue):** mock arq pool; assert tại thời điểm `enqueue_job` được gọi, data ĐÃ commit (row truy vấn được bằng session khác / committed). Chống tái phát race.
- **Boundary-commit regression:** sau khi gỡ commit ở service, test happy-path qua route (async_client) vẫn persist (get_db boundary commit) — đảm bảo không "mất commit".
- **Worker checkpoint survives rollback:** ingest lỗi giữa chừng → business rollback NHƯNG status='failed' vẫn ghi (transaction status riêng).

## Tinh chỉnh từ outside voice (Codex) — đã fold vào plan
1. **Boundary ownership rõ ràng (Codex #1,#2,#4):** HTTP route DÙNG DUY NHẤT `get_db` làm boundary (không trộn get_uow trên cùng session trong cùng request). `get_uow`/`uow_context` CHỈ cho worker + code mới. `commit-trước-enqueue` là NGOẠI LỆ tường minh: sau early commit, KHÔNG mutation business thêm trong cùng transaction (nếu cần thì mở transaction mới). Ghi rõ "Phase 3 = gỡ commit rải rác + boundary có sẵn, không phải áp UoW cho HTTP" — đúng bản chất.
2. **Checkpoint status = SESSION RIÊNG ngắn (Codex #6,#7):** mark running/error/success dùng session độc lập, KHÔNG `commit()` trên session business (tránh partial-commit business). `status='success'` chỉ ghi SAU khi business transaction commit xong.
3. **Enforcement (Codex #5):** thêm test/CI scan chặn `.commit()` tái xuất ở business path (route/worker) với allowlist (boundary + checkpoint status có comment). Không chỉ grep thủ công.
4. **Audit commit-dependent reads (Codex #9):** trước khi gỡ mỗi commit, kiểm code sau đó có dựa vào commit để lấy id/default/refresh/relationship/trigger/timestamp không → dùng `flush()`/`refresh()` thay thế nếu cần. Ghi vào checklist mỗi task.
5. **Semantic extraction thay line-number (Codex #12):** worker ingest tách hàm `mark_ingest_status(...)` (checkpoint) vs `run_ingest_business(...)` (transaction) — KHÔNG annotate theo số dòng (rot khi sửa).
6. **Test validity (Codex #8):** enqueue-visibility test phải dùng CONNECTION/SESSION riêng (không phải request session, không savepoint fixture che) để phản ánh đúng commit thật.
7. **Enqueue failure (Codex #3 — đã chốt):** commit OK nhưng enqueue lỗi → wrap try/except, giữ status recoverable ('pending/queued') + log cảnh báo; reconciliation để TODO (KHÔNG làm outbox trong Phase 3).
8. **UoW commit-failure (Codex #13):** `__aexit__` xử lý rõ khi commit raise (rollback/close an toàn, không nuốt lỗi).
9. **Nested transaction policy (Codex #14):** service gọi service KHÔNG tự mở UoW/commit — dùng chung session của boundary; chỉ boundary commit. Ghi thành quy ước.
10. **Sequencing (Codex #11):** route đổi enqueue-ordering phải đi KÈM (hoặc có compat test) với worker flow tương ứng — không để route đổi trước worker chưa fix.

## NOT in scope (Phase 3)
- Transactional outbox cho enqueue (chấp nhận rủi ro nhẹ — xem #7); reconciliation job → TODO.
- Đổi mọi route sang `Depends(get_uow)` (scope tối thiểu — phase sau nếu cần).
- Dọn trùng `extract_template_from_document_impl` (template_service.py:811 ↔ generator_template_service.py:871) — duplication có sẵn, thuộc Phase 7 cleanup.
- AI Gateway / chat unify / extraction (Phase 4-5).

## What already exists (tái dùng, không xây lại)
- `core/database.py:get_db()` — đã auto-commit/rollback cuối request = HTTP boundary có sẵn (giữ).
- `repositories/base.py` — đã flush-only (đúng, không đổi).
- `worker/context.py` — đã có `session_factory` per-task (bọc bằng `uow_context`).
- `worker/dispatch.py:dispatch_task` — đã tạo BackgroundTask + commit (chuyển thành commit-trước-enqueue tường minh).

## Implementation Tasks
Synthesized từ review. Mỗi task gắn một finding.

- [ ] **T1 (P1, human ~1h / CC ~10min)** — core/uow — `core/uow.py` (UnitOfWork + `__aexit__` xử lý commit-failure) + `get_uow` + `uow_context`; KHÔNG đổi call site.
  - Surfaced by: Architecture — scope tối thiểu + Codex #13.
  - Verify: test commit-on-exit / rollback-on-exc / commit-failure handling.
- [ ] **T2 (P1, human ~30min / CC ~5min)** — boundary rule + enforcement — quy ước "HTTP chỉ get_db; service/service không tự commit" + test/CI scan chặn `.commit()` business path (allowlist boundary+checkpoint).
  - Surfaced by: Codex #1,#2,#4,#5,#14.
  - Verify: scan test đỏ khi thêm `.commit()` trái phép.
- [ ] **T3 (P1)** — per-domain remove-commit (ai_config→chat→generator/template→review/document) — gỡ commit service/route theo domain; audit commit-dependent reads (id/refresh) → flush/refresh.
  - Surfaced by: Code Quality + Codex #9; mỗi domain 1 commit.
  - Verify: test "lỗi giữa chừng → rollback toàn bộ" mỗi domain + happy-path boundary regression.
- [ ] **T4 (P1)** — commit-before-enqueue — mọi flow có enqueue: commit data TRƯỚC enqueue_job; wrap enqueue try/except (status recoverable + log).
  - Surfaced by: Architecture #2 + Codex #3,#11.
  - Verify: enqueue-visibility test (session/connection riêng) + enqueue-failure → status recoverable.
- [ ] **T5 (P1)** — worker UoW — tách `mark_ingest_status()` (session riêng) vs `run_ingest_business()` (uow_context); status='success' chỉ sau business commit.
  - Surfaced by: Codex #6,#7,#12.
  - Verify: ingest lỗi → business rollback nhưng status='failed' ghi được.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 15 điểm; 3 fold thành quyết định, 7 fold thành tinh chỉnh, còn lại NOT-in-scope |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 2 issues (scope, enqueue-ordering) đã giải quyết; 0 critical gap |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — (backend-only) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **CODEX:** outside voice bắt 15 điểm; quyết định 3 (boundary model, enqueue-failure, semantic-extraction), fold 7 tinh chỉnh (checkpoint session riêng, enforcement scan, commit-dependent audit, test validity, nested-tx policy, sequencing, commit-failure), 2 đẩy NOT-in-scope (outbox, get_uow-everywhere).
- **CROSS-MODEL:** Claude review bắt scope + enqueue-ordering; Codex bổ sung tính đúng đắn checkpoint/boundary/enforcement. Hợp nhất, không mâu thuẫn tồn đọng.
- **VERDICT:** ENG CLEARED — plan Phase 3 sẵn sàng thực thi incremental (5 task T1-T5, STRICT mỗi task).

NO UNRESOLVED DECISIONS
