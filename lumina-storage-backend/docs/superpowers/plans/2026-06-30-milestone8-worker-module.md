# Phase 8 — Worker reliability + module hóa route (L, cuối) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Mỗi task STRICT: TDD (RED→GREEN) → full suite → critique outside-voice → fix → commit (Conventional Commits, KHÔNG push).
> Spec gốc §Phase 8: `~/.claude/plans/chu-n-h-a-l-i-to-n-serene-blanket.md` (line 75).

## Context

Phase 8 là milestone "L, cuối" ĐA-PR. Gồm 4 workstream lớn: (a) **worker** DLQ + sửa race dedupe nuốt re-ingest + correlation-id; (b) tách **review.py**(3743) route → service+ai; (c) tách **generator.py**(2328) route → service+ai; (d) module hóa **domain/<x>/** (git mv). Ước tính (b)+(c)+(d) ~36h/đa-PR. Session này SCOPE phần **giá trị cao nhất + an toàn**: worker reliability (3 lỗi correctness/observability THẬT) + tách PURE helper generator.py (zero-behavior slice). Phần còn lại (review service, generator business-logic→service, domain git-mv) DOCUMENT làm Phase 8 backlog với inventory đã có (giữ chất lượng > nhồi nhét).

**Inventory (agent-verified):**
- **Dedupe race (BUG):** `dispatch.py:_dedupe_job_id` = sha256(func:related_id)[:24] ỔN ĐỊNH + arq `keep_result=3600` → job đã xong/lỗi vẫn giữ id trong Redis 1h → `enqueue_job(_job_id=...)` trả None → re-ingest NUỐT IM LẶNG (BackgroundTask tạo nhưng job_id=None, không queue). Test `test_dispatch_uow.py` hiện ASSERT hành vi sai này là "chấp nhận được".
- **Không DLQ:** max_tries=3 hết / worker crash → BackgroundTask kẹt status "running" mãi (mark_ingest_status chỉ gọi trong task code, không có handler khi exhaust). Không có terminal-failure marking.
- **Correlation-id:** `dispatch_task` không bắt `correlation_id.get()`; worker task (document.py) log KHÔNG có request_id → đứt chuỗi trace API→worker.
- **generator.py pure helpers:** DOCX (47-187, 5 hàm) + HTML (1249-1562, ~10 hàm) — PURE (no DB/service), import-only move → `generator_docx.py` + `generator_html.py`.

## Global Constraints

- Test từ ROOT: `docker compose --profile test run --rm test uv run pytest <path> -q`. Baseline **375 passed**, import-linter 2 kept 0 broken.
- **PURE REFACTOR cho T4** (zero-behavior); **BUG FIX cho T1-T3** (đổi hành vi = SỬA lỗi, có test pin). Comment tiếng Việt; commit per task, KHÔNG push.
- Worker: arq, `ctx['job_try']` có sẵn; blue/green re-ingest (Phase 5) IDEMPOTENT (double-enqueue hiếm = an toàn, swap active version). `correlation_id` từ `asgi_correlation_id.context`.
- Mỗi task STRICT (TDD→suite→critique→fix→commit). import-linter phải vẫn xanh.

## What already exists (tái dùng)

- `dispatch.py:dispatch_task` (commit-trước-enqueue 2-phase), `BackgroundTask` model (status pending/running/success/failure, related_id, job_id unique), `mark_ingest_status` (document.py:111).
- `ingest_document_task(ctx, task_id, document_id)` (document.py:210); worker `WorkerSettings` (settings.py, max_tries=3, keep_result=3600).
- `core/logging.py:_add_correlation_id` (gắn request_id từ context vào log).
- `GeneratorService` (Phase 6); test_dispatch_uow/test_worker_uow.

## File Structure

- Modify: `src/worker/dispatch.py` (in-flight dedupe + unique job_id + capture correlation_id), `src/worker/tasks/document.py` (terminal-failure/DLQ handler + set correlation context), `src/worker/context.py` (worker correlation setup nếu cần), `tests/core/test_dispatch_uow.py` (cập nhật assertion theo hành vi ĐÚNG mới).
- Create: `src/services/generator_html.py` + `src/services/generator_docx.py` (T4 pure helpers); `tests/core/test_dispatch_dedupe_race.py`, `tests/core/test_worker_dlq.py`, `tests/core/test_worker_correlation.py`.

---

### Task 1: Sửa dedupe race nuốt re-ingest (in-flight DB check + unique job_id)

**Vấn đề:** stable job_id + arq keep_result → re-ingest sau khi job xong/lỗi bị trả None → nuốt. **Fix:** dedupe dựa **in-flight BackgroundTask** (status pending/running cùng task_name+related_id) thay vì arq stable-id; enqueue job_id UNIQUE = `str(record.id)` (không đụng stale result).

**Files:** `dispatch.py`; `tests/core/test_dispatch_dedupe_race.py` + cập nhật `test_dispatch_uow.py`.

**Fix ATOMIC (critique P0#1/#12): partial unique index chống concurrent double-enqueue (tránh clobber active_ingest_version).**
- Migration: `CREATE UNIQUE INDEX uq_backgroundtask_inflight ON processing_backgroundtask (task_name, related_id) WHERE status IN ('pending','running')`.
- dispatch: in-flight check (trả existing nếu có); nếu không → add+flush; nếu flush ném IntegrityError (race TOCTOU 2 request đồng thời) → rollback, re-query in-flight, trả existing. enqueue `_job_id=str(record.id)` UNIQUE (không đụng stale result).
```python
if dedupe and related_id is not None:
    existing = await _find_inflight(db, task_name, related_id)
    if existing is not None:
        return existing
record = BackgroundTask(...); db.add(record)
try:
    await db.flush()
except IntegrityError:           # partial-unique vi phạm → request khác vừa tạo
    await db.rollback()
    existing = await _find_inflight(db, task_name, related_id)
    if existing is not None: return existing
    raise
await db.commit(); ...
job = await arq_pool.enqueue_job(func_name, record.id, _job_id=str(record.id), **kwargs)
```

- [ ] **Step 1 RED** test_dispatch_dedupe_race: (a) in-flight (pending/running) → dispatch lần 2 trả CÙNG record; (b) record cũ status="success" → dispatch lần 2 TẠO mới + enqueue (KHÔNG nuốt — bug cũ); (c) status="failure" → re-enqueue.
- [ ] **Step 2-3 GREEN** migration partial-unique + in-flight check + IntegrityError-recover + unique job_id. Cập nhật test_dispatch_uow:103 (`test_dispatch_job_none...` mock None vẫn pass nhưng đổi tên/comment phản ánh semantics mới — KHÔNG còn là "dedupe collision").
- [ ] **Step 4** migration apply + full suite + lint. **Step 5 commit** `fix(worker): dedupe in-flight + partial-unique chống nuốt/clobber re-ingest (T1 P8)`.

---

### Task 2: DLQ — terminal-failure khi exhaust retry / crash

**Vấn đề:** max_tries hết / crash → status kẹt "running". **Fix:** wrap ingest task: exception KHÔNG mong đợi → nếu `ctx['job_try'] >= max_tries` → mark "failure" (DLQ: status=failure queryable) + KHÔNG re-raise (terminal); else re-raise (arq retry).

**Files:** `document.py` (ingest_document_task + các *_task), `tests/core/test_worker_dlq.py`.

**2 phần (critique P0#3 + P1#4/#5/#11):** (a) terminal-failure khi exhaust retry; (b) **reconciliation cron** mark stale-"running" (quá `job_timeout`) → failure → gỡ kẹt crashed worker (in-flight dedup mới không nuốt vĩnh viễn). Extract task đã tự catch+mark → CHỈ áp (a) cho ingest_document_task (task raise unhandled). mark-failure bọc try/except (không nuốt lỗi gốc).

- [ ] **Step 1 RED** test_worker_dlq: (a) ingest task raise unhandled + `ctx={'job_try':3}` max=3 → status="failure" + error (KHÔNG re-raise); job_try<max → re-raise. (b) cron reconcile: BackgroundTask "running" created quá hạn → đổi "failure".
- [ ] **Step 2-3 GREEN** ingest task: bọc body, except Exception → nếu job_try>=max_tries: mark failure (best-effort) + KHÔNG re-raise; else re-raise. Cron `reconcile_stale_tasks` vào WorkerSettings.cron_jobs (mark running > job_timeout → failure).
- [ ] **Step 4** full suite. **Step 5 commit** `fix(worker): DLQ terminal-failure + reconcile stale-running cron (T2 P8)`.

---

### Task 3: Correlation-id propagate API→worker

**Vấn đề:** worker log thiếu request_id. **Fix:** dispatch_task bắt `correlation_id.get()` → truyền kwarg `request_id`; task set `correlation_id.set(request_id)` đầu hàm → log có request_id.

**Files:** `dispatch.py`, `document.py`, `tests/core/test_worker_correlation.py`.

**Critique P1#6:** worker dùng plain logging.basicConfig → structlog `_add_correlation_id` KHÔNG chạy ở worker → set ContextVar vô ích. Fix: worker `startup` gọi `configure_logging()` (structlog + processor) → log worker có request_id.

- [ ] **Step 1 RED** test: dispatch trong context có cid → enqueue kwargs có request_id; task set context → log chứa request_id (caplog/mock).
- [ ] **Step 2-3 GREEN** dispatch capture `correlation_id.get()` → kwarg `request_id`; ingest task set `correlation_id.set(request_id)` đầu hàm (try/except); worker startup `configure_logging()`.
- [ ] **Step 4** full suite. **Step 5 commit** `feat(worker): propagate correlation-id API→worker + structlog worker (T3 P8)`.

---

### Task 4: Tách PURE helper generator.py → module (zero-behavior)

**Vấn đề:** generator.py 2328 dòng trộn HTTP + helper thuần. **Fix:** move helper PURE (no DB/service) sang module: DOCX (47-187) → `generator_docx.py`; HTML (1249-1562) → `generator_html.py`. generator.py import lại. Zero-behavior (import-only).

**Files:** Create `src/services/generator_docx.py` + `generator_html.py`; Modify `generator.py` (import). Test: full suite generator (e2e) + characterization nếu cần.

- [ ] **Step 1** xác định CHÍNH XÁC hàm pure (no `db`/`Depends`/service) + mọi call-site trong generator.py.
- [ ] **Step 2 GREEN** move sang module, generator.py import; giữ __all__/tên. (Pure move — full suite e2e generator là characterization.)
- [ ] **Step 3** full suite + lint (import-linter: module mới ở services, không phá layering). **Step 4 commit** `refactor(generator): tách pure DOCX/HTML helper ra module (T4 P8)`.

---

### Task 5: Checkpoint Phase 8 + document remaining

- [ ] Full suite + smoke (app boot, worker import) + import-linter 2 kept 0 broken.
- [ ] Báo cáo Word `docs/Lumina_Storage_Milestone8_*.docx` — gồm: worker fixes (T1-T3) + generator helper (T4) + **PHASE 8 REMAINING** (review.py ReviewService split, generator business-logic→GeneratorService, domain/<x>/ git-mv) với inventory LOC đã map (làm sau, đa-PR).
- [ ] Commit `test(worker): checkpoint Phase 8 + document remaining`.

## NOT in scope (Phase 8 remaining — documented, đa-PR sau)

- **review.py(3743)→ReviewService**: pure helper (review_extraction/parsing/scoring ~1100 LOC) + ReviewService (_run_review 311, _build_review_prompt 243, _persist_eval_pdf 106). MEDIUM risk.
- **generator.py business-logic→GeneratorService**: _apply_html_edits_to_docx(116), _execute_generate(83), _validate_field_values(46), _llm_propose_ops(48) + fat endpoint generate_from_session(232).
- **domain/<x>/ git-mv**: churn cao, giá trị tổ chức — từng domain 1 PR, sau khi route splits xong.

## Verification

1. `docker compose --profile test run --rm test uv run pytest -q` — full suite xanh (375+).
2. `uv run lint-imports` — 2 kept, 0 broken.
3. Dedupe: re-ingest sau completion KHÔNG bị nuốt (test); crash → status=failure (không kẹt running); worker log có request_id.
4. generator.py giảm dòng; smoke app+worker import OK.
5. Báo cáo Word Milestone 8 (+ remaining backlog).

## Rủi ro & Rollback

- T1 đổi hành vi dedupe = SỬA bug (double-enqueue hiếm an toàn vì blue/green idempotent). T2/T3 thêm robustness. T4 pure move (full suite e2e bắt regression). Rollback: git revert từng task.

## GSTACK REVIEW REPORT (outside-voice critique — đã resolve)

- **P0#1+#12 (concurrent double-enqueue → clobber active_ingest_version):** RESOLVED — partial unique index `(task_name,related_id) WHERE status IN (pending,running)` + IntegrityError-recover (atomic, diệt TOCTOU). Một in-flight job/document → không clobber.
- **P0#3 (stale-running kẹt vĩnh viễn):** RESOLVED — T2 reconciliation cron mark running quá job_timeout → failure (gỡ kẹt crashed worker; partial-index nhả khi status đổi).
- **P1#4 (test ctx job_try):** RESOLVED — test_worker_dlq mock `ctx={'job_try':3}` max=3.
- **P1#5 (mark-failure raise nuốt lỗi gốc):** RESOLVED — bọc mark-failure best-effort try/except.
- **P1#6 (worker không structlog):** RESOLVED — worker startup gọi configure_logging() (processor correlation chạy).
- **P1#11 (extract task đã handle):** RESOLVED — terminal-failure CHỈ áp ingest_document_task; extract tự catch+mark; cron phủ tất cả.
- **P2#8 (test_dispatch_job_none):** mock None vẫn pass; đổi tên/comment phản ánh "enqueue trả None bất thường" (không còn dedupe-collision).
- **P2#9 (T4 helper async gotenberg):** `_html_to_pdf_bytes`/`_html_to_docx_via_gotenberg` movable (no DB/route) nhưng CÓ side-effect HTTP — move kèm, document rõ (không gọi "pure" tuyệt đối).
- **P2#10 (cycle):** SAFE — helper chỉ dùng stdlib+docx/bs4/bleach/httpx, không import generator.py.
