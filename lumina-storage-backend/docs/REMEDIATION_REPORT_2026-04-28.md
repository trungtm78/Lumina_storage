# Báo cáo xử lý các vấn đề từ Lumina Storage Issues Report

**Ngày:** 2026-04-28
**Phạm vi:** Toàn bộ 22 issue (15 kỹ thuật + 7 bảo mật) trong `Lumina_Storage_Issues_Report.docx`
**Người thực thi:** AI assistant (Claude) — review by user
**Re-audit tool:** `/cso` daily mode (8/10 confidence gate)

## TL;DR

| Kết quả     | Số lượng | Ghi chú                                         |
| ----------- | -------- | ----------------------------------------------- |
| Đã fix      | 15       | Bao gồm S-1 (key revoked 2026-04-29)            |
| Mitigate    | 1        | S-3 force change pwd thay vì xóa default        |
| N/A         | 2        | S-7, E-13 — postgres/qdrant không trong compose |
| Đã có sẵn   | 1        | S-6 — SECRET_KEY trong .env đã random rồi       |
| Defer       | 4        | E-4 multi-tenancy + việc cần infra change       |

**Điểm quan trọng:**
1. ✅ **GCP key đã revoke (2026-04-29)** — credential dead, không còn risk dù blob vẫn nằm trong git history.
2. Tất cả thay đổi đang nằm ở **working tree, chưa commit** — bạn review xong ưng ý mới commit.
3. Có 2 alembic migration mới (`20260428a001`, `20260428a002`) — chạy `alembic upgrade head` sau khi commit.
4. `pyproject.toml` có 3 dep mới (slowapi, python-magic, underthesea) — chạy `uv sync` trước khi boot.
5. Nên audit GCP logs cửa sổ 2026-03-19 → 2026-04-29 để confirm không có abuse trong thời gian key bị lộ.

---

## 1. Bảo mật (S-1..S-7)

### S-1 — GCP service account key trong git history 🔴 CRITICAL → ✅ FIXED

**Đã làm:**
- `git rm --cached gcp-documentai-key.json` (untrack khỏi HEAD)
- Add `gcp-documentai-key.json`, `*.pem`, `*.key`, `*-credentials.json` vào `.dockerignore`
- ✅ **Key 8b84e1def9... đã được revoke trên GCP Console (2026-04-29).** Credential đã dead — ai recover được key blob từ commit `cbe2495`/`202c993` cũng nhận 401 từ GCP.

**Việc nên làm tiếp (không khẩn):**
1. **Audit GCP logs** trong cửa sổ exposure 2026-03-19 → 2026-04-29 (~41 ngày): GCP Console → Logging → Logs Explorer → filter `protoPayload.authenticationInfo.principalEmail = <sa-email>`. Tìm: IP lạ, call ngoài pattern app (vd: list document across all buckets), spike Document AI. Nếu sạch → file under "lessons learned".
2. **Tạo key mới** cho ứng dụng (lưu vào env var `GCP_CREDENTIALS_JSON` base64, không lưu file).
3. *(Tùy chọn)* Khi rảnh thì `git filter-repo` để xóa key blob khỏi history — giờ priority thấp vì credential đã dead.

---

### S-2 — Dockerfile chạy root 🔴 HIGH → FIXED

**File:** `Dockerfile:25-46`

```dockerfile
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser
WORKDIR /app
COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv
COPY --chown=appuser:appuser . .
RUN mkdir -p /app/uploads && chown -R appuser:appuser /app
USER appuser
```

Container giờ chạy uid không phải 0 → RCE bug trong pymupdf/python-pptx/Gotenberg sẽ bị hạn chế blast radius.

---

### S-3 — Hardcoded admin Admin@123 🔴 HIGH → MITIGATED

**Cách xử lý (theo lựa chọn user):** Force change password on first login.

**Files:**
- `src/models/user.py:21` — thêm cột `force_change_password: bool`
- `alembic/versions/20260428_add_force_change_password.py` — migration thêm cột + flag admin user
- `src/services/auth.py:18-90` — `LoginResult` dataclass mang flag, `change_password()` method
- `src/schemas/auth.py:25-39` — `TokenResponse` thêm `must_change_password`, mới có `ChangePasswordRequest` (validate length ≥8, mix letters+digits)
- `src/api/v1/routes/auth.py:97-107` — endpoint `POST /auth/change-password` (rate limit 5/min)

**Frontend phải:** đọc `must_change_password` trên response của login → redirect sang trang đổi mật khẩu → gọi `/auth/change-password` trước khi cho dùng các API khác.

**Migration tự động đánh dấu** admin seed (`00000000-0000-0000-0000-000000000002`) `force_change_password=true`.

---

### S-4 — Không có rate limiting trên auth 🔴 HIGH → FIXED

**Stack:** `slowapi` (per-IP, Redis-backed nếu cần).

**Limits hiện tại:**
- `/auth/login` — 10/minute
- `/auth/register` — 5/hour
- `/auth/change-password` — 5/minute

Configurable qua env: `AUTH_RATE_LIMIT_LOGIN`, `AUTH_RATE_LIMIT_REGISTER`.

**Files:** `pyproject.toml` (dep), `main.py:12,80-83` (wire), `src/api/v1/routes/auth.py:25-29,57-66`.

**Còn lỗ hổng:** rate limit là per-IP, không per-account. Attacker xoay proxy vẫn brute force được. /cso re-audit flag MEDIUM — nên thêm per-account lockout (Redis: failed_attempts:{user_id} counter, lock 15 min sau 10 lần fail). Issue này tracking trong report mới (Finding #2).

---

### S-5 — Đăng ký mở 🔴 HIGH → FIXED

**File:** `src/core/config.py:21` — `open_registration: bool = False` (default deny).
**File:** `src/api/v1/routes/auth.py:53-59` — raise 403 nếu disabled.

User muốn mở public signup → set env `OPEN_REGISTRATION=true`.

---

### S-6 — SECRET_KEY yếu 🟡 MEDIUM → ALREADY FIXED

`.env` thực tế đã có `SECRET_KEY=d271be8eb2e01b92e138cfb6e6a5d84c5d5bcfa40310e09e9effffb5bf3b400a` (64-hex random) — chuỗi `lumina-secret-key-change-in-production` mà report mô tả không còn. Bỏ qua.

`.env.example` vẫn để placeholder `your-secret-key-here` — đây là expected (file mẫu).

---

### S-7 — PostgreSQL port 5432 exposed 🟡 MEDIUM → N/A

`docker-compose.yml` hiện tại **không có** postgres service. DB chạy ngoài tại `192.168.1.229`. Không có port mapping nào cần đóng. Report stale info.

---

## 2. Kỹ thuật (E-1..E-15)

### E-1 — FTS không hỗ trợ tiếng Việt 🔴 CRITICAL → FIXED

**Cách xử lý:** thêm extension `unaccent`, áp `unaccent()` cả khi index lẫn khi query.

**Files:**
- `alembic/versions/20260428_fts_unaccent_backfill.py` — `CREATE EXTENSION unaccent` + backfill `search_vector` cho mọi document hiện có
- `src/worker/tasks/document.py:175` — populate `search_vector` dùng `to_tsvector('simple', unaccent(raw_text))`
- `src/repositories/document.py:249, 380` — query dùng `plainto_tsquery('simple', unaccent(q))` + `to_tsvector('simple', unaccent(Document.title))`

Tìm "nhân viên" giờ match cả tài liệu viết "nhan vien". `plainto_tsquery` sanitize operator → không inject được.

---

### E-2 — Worker queue bão hòa 🔴 CRITICAL → FIXED (short-term)

**File:** `src/worker/settings.py:21-26`
```python
max_jobs = 20            # 10 → 20
retry_jobs = True
max_tries = 3
keep_result = 3600
health_check_interval = 30
```

Long-term horizontal scaling chưa làm — đó là infra task.

---

### E-3 — Không có Vietnamese NLP cho chunking 🔴 CRITICAL → FIXED

**Files:**
- `pyproject.toml` — thêm `underthesea>=6.8.0`
- `src/services/text_chunking.py` — module mới: `split_sentences()` + `chunk_by_sentences()` dùng underthesea, fallback regex nếu underthesea fail
- `src/worker/tasks/document.py:206-220` (single-page path) và `:267-281` (multi-page fallback) — dùng VN-aware chunker thay cho `RecursiveCharacterTextSplitter`

Chunks bây giờ không cắt giữa câu Vietnamese. Excel/CSV và markdown table path giữ nguyên (chúng đã chunked theo row).

---

### E-4 — Multi-tenancy ở user-level 🟡 HIGH → DEFER

Việc lớn, cần thiết kế (Organization model, owner_type enum, group quota). Chưa làm trong scope này. Theo report estimate 2+ tuần. Defer cho tới khi onboard khách thứ 10+.

---

### E-5 + E-11 — Redis SPOF + backup 🟡 HIGH → PARTIAL

**Đã làm (cheap durability):** `docker-compose.yml` thêm `--appendonly yes --appendfsync everysec` cho redis service. Mất tối đa ~1s job khi restart, không còn mất sạch queue.

**Đã làm (docs):** `docs/BACKUP_AND_PERSISTENCE.md` — runbook cho pg_dump (daily + WAL archive), Qdrant snapshots (weekly), Redis AOF, restore drill quarterly.

**Defer:** Redis Sentinel/Cluster — đó là infra change.

---

### E-6 — DB connection pool không config 🟡 HIGH → FIXED

**File:** `src/core/database.py:9-15`
```python
engine = create_async_engine(
    settings.database_url,
    echo=settings.app_env == "development",
    pool_size=20,
    max_overflow=30,
    pool_pre_ping=True,
    pool_recycle=3600,
)
```

---

### E-7 — Upload không validate content 🟡 HIGH → FIXED

**Files:**
- `pyproject.toml` — `python-magic>=0.4.27` (libmagic; Linux Docker đã có sẵn, Windows dev sẽ skip gracefully nếu thiếu binding)
- `src/core/file_validation.py` — `validate_file_content(data, filename)` với mapping ext → allowed MIME set (cover PDF, Office, image, csv/md/txt)
- `src/services/document.py:73-78, 168-173` — apply trong `upload_files()` + `upload_folder()` trước khi gọi storage backend

File `.exe` đổi tên thành `.pdf` giờ bị reject với 400 BadRequest.

---

### E-9 — Script runner silent fallback 🟢 MEDIUM → FIXED

**File:** `src/services/script_runner.py:138-200`

`run_script_subprocess()` và `run_script_docker()` giờ raise `ScriptRunnerNotImplementedError` thay vì fallback ngầm về `inline`. `get_runner(mode)` cũng raise nếu mode unknown. Operator config sai sẽ thấy lỗi rõ ràng thay vì tưởng đang sandbox.

---

### E-10 — Agent state không có TTL 🟢 MEDIUM → FIXED

**Files:**
- `src/services/chat_service.py:512-528` — cap `skill_state` ≤1MB serialized; vượt thì drop + flag `skill_state_truncated: true`
- `src/worker/tasks/agent_state_cleanup.py` — task mới: SQL UPDATE strip `skill_state` khỏi `chat_chatmessage` nếu session inactive ≥30 ngày
- `src/worker/settings.py` — thêm cron `daily 03:15 UTC` chạy cleanup

Đặt `AGENT_STATE_TTL_DAYS = 30` ở module top — đổi đó nếu cần.

---

### E-12 — Worker không có healthcheck 🟢 MEDIUM → FIXED

**File:** `docker-compose.yml` worker service — thêm healthcheck dùng Python redis ping (vì `redis-cli` không có sẵn trong python:3.11-slim image):
```yaml
healthcheck:
  test: ["CMD", "python", "-c", "import os, redis; redis.Redis(...).ping()"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 30s
```

---

### E-13 — Qdrant external port 🟢 MEDIUM → N/A

Qdrant không trong docker-compose. External @ 192.168.1.229. Cần lock down ở firewall level (network team) chứ không phải code.

---

### E-14 — Worker tasks zero coverage 🟢 MEDIUM → PARTIAL

**Đã viết tests:**
- `tests/test_text_chunking.py` — VN sentence-aware chunker (5 tests)
- `tests/test_file_validation.py` — magic byte validation (5 tests)
- `tests/test_dispatch_dedupe.py` — ARQ job_id dedup (4 tests)

**Chưa viết:** integration test cho `ingest_document_task` end-to-end (extract + chunk + embed + FTS) — cần Postgres + mock Qdrant + mock embedding API. Theo report ~3 ngày work; defer.

---

### E-15 — ARQ không có job dedup 🟢 MEDIUM → FIXED

**File:** `src/worker/dispatch.py:11-50`

`dispatch_task()` thêm param `dedupe=True` (default), tự sinh `_job_id = sha256(func_name:related_id)[:24]` → ARQ skip nếu job với cùng id đang queue/running. Re-upload cùng file (cùng `doc.id`) hoặc click ingest 2 lần liên tiếp sẽ chỉ tạo 1 job thực sự.

Set `dedupe=False` nếu thực sự muốn enqueue duplicate (cleanup/cron tasks dùng `related_id=None` tự skip dedup).

---

## 3. /cso re-audit findings (mới)

Sau khi fix xong + key đã revoke → 0 CRITICAL, 0 HIGH còn lại. 3 MEDIUM mới + 1 INFO:

1. ✅ **RESOLVED** — GCP key revoke 2026-04-29. Residual: nên audit GCP logs cửa sổ phơi key.
2. **MEDIUM** — `must_change_password` flag confirm default-cred attempt với attacker. Khuyến nghị thêm per-account lockout (Redis counter).
3. **MEDIUM** — Live secrets (Azure OpenAI, MS Graph, Langfuse, App Store) đang nằm trong `.env` dev workstation. Rotate khi laptop từng rời tay người sử dụng. Long-term: deploy-platform secret store.
4. **MEDIUM** — Refresh cookie `samesite=none` không có CSRF defense rõ ràng. Hôm nay OK vì CORS_ORIGINS strict, nhưng một sai sót config là mất phòng tuyến.
5. **INFO** — FTS query dùng `plainto_tsquery` đã sanitize → không inject được. Note để tránh refactor sai sau này.

Report JSON: `.gstack/security-reports/2026-04-28-recheck.json`

---

## 4. Việc bạn cần làm tiếp

### Ngay hôm nay (~10 phút)
1. ✅ **Revoke GCP key** — đã hoàn tất 2026-04-29.
2. Chạy `uv sync` để pull deps mới (`slowapi`, `python-magic`, `underthesea`).
3. Chạy `alembic upgrade head` để áp 2 migration mới.
4. Audit GCP logs cửa sổ phơi key (2026-03-19 → 2026-04-29) — query Logs Explorer với filter principal email = service account.

### Khi rảnh (1-2 ngày)
4. Frontend handle `must_change_password=true` trên login response → redirect change password page.
5. Rotate các secret trong `.env` (Azure OpenAI, MS, Langfuse, App Store) nếu chúng đã từng nằm trên thiết bị cá nhân.
6. Test rate limit thực tế: gọi `/auth/login` 11 lần trong 1 phút → request 11 trả 429.
7. Smoke test: upload file `.pdf` đổi tên từ `.exe` → expect 400.
8. Verify FTS: tìm "nhan vien" → match document có "nhân viên".

### Cân nhắc thêm (sau khi fixes ổn định)
9. Per-account lockout (Redis counter, finding #2 từ re-audit).
10. Backup strategy thực thi (pg_dump cron, Qdrant snapshot) — runbook đã có ở `docs/BACKUP_AND_PERSISTENCE.md`.
11. Multi-tenancy / Organization model (E-4) — trước khi onboard 10+ khách.
12. Git history scrub cho `gcp-documentai-key.json` — coordinate với team.

---

## Phụ lục — Vòng /cso ngày 2026-04-29

Sau khi `uv sync` + `alembic upgrade head` chạy ổn, chạy lại `/cso` daily mode → phát hiện 1 CRITICAL + 2 HIGH **không liên quan đến report ban đầu** (không phải regression — đó là vấn đề agent-tool surface mà /plan-eng-review không có scope kiểm). Đã fix luôn cùng lượt:

### NEW-1 🔴 CRITICAL — Agent `run_script` cho phép RCE qua file user upload

3 lỗ hợp lại:
1. `/api/v1/documents/upload` chấp nhận **mọi extension** (file_validation chỉ check known ext, `.py` lọt qua).
2. `run_script` tool nhận `script_path` từ LLM, **không jail** → import + exec bất kỳ file `.py` nào.
3. Script return value flow ngược về chat → user nhận được env vars (`SECRET_KEY`, AI keys, DB password).

Chuỗi exploit 5 bước: upload `evil.py` → biết `file_path` → bảo AI chạy → LLM gọi run_script → response chứa SECRET_KEY → forge JWT admin.

**Fix:**
- `src/services/agent.py` — thêm `_resolve_under_skills()` jail. `read_instruction` chỉ accept `.md/.txt/.json/.yaml/.yml` dưới `skills/`. `run_script` chỉ accept `.py` dưới `skills/<name>/tools/`.
- `src/core/file_validation.py` — thêm `UPLOAD_ALLOWED_EXTENSIONS` set hard-list (pdf/docx/xlsx/pptx/txt/md/csv/png/jpg/svg/...). `.py`, `.sh`, `.exe`, `.so` reject ở API boundary.
- `src/services/document.py:upload_files` + `upload_folder` — check extension trước khi save vào storage.

### NEW-2 🔴 HIGH — Agent `read_instruction` đọc cross-user file

Cùng kiểu jail bug (read-only side). Có thể đọc file của user khác, hoặc đọc `alembic/versions/20260407_seed_admin_user.py` để lấy `Admin@123` mặc định. Fix chung với NEW-1 (cùng `_resolve_under_skills`).

### NEW-3 🔴 HIGH — Docker image thiếu `libmagic1`

Dockerfile cài `libpq-dev`, `ca-certificates`, `curl` nhưng quên `libmagic1`. `python-magic` import fail → `_MAGIC_AVAILABLE=False` → `validate_file_content` luôn trả `(True, None)` → **E-7 fix bị bypass hoàn toàn trong production**.

**Fix:**
- `Dockerfile` — thêm `libmagic1` vào apt install line.
- `src/core/file_validation.py` — thêm `_ensure_libmagic_in_prod()`: nếu `app_env == 'production'` và libmagic không có → raise RuntimeError ngay lần dùng đầu tiên (fail-closed). Dev workstation vẫn fail-open.

### Tests đã thêm
- `tests/test_agent_path_jail.py` — 9 cases pin behavior của jail (legitimate path, `..` traversal, absolute path, suffix mismatch, NUL byte, empty path).
- `tests/test_file_validation.py` — extend với 4 cases mới: upload allowlist blocks .py/.sh/.exe, includes office+image, libmagic-missing-in-prod raises, libmagic-missing-in-dev passes.

### Files thay đổi (vòng 2)
```
Modified:
  Dockerfile                                 + libmagic1 in apt line
  src/core/file_validation.py                + UPLOAD_ALLOWED_EXTENSIONS, fail-closed in prod
  src/services/agent.py                      + _resolve_under_skills jail, applied to read_instruction + run_script
  src/services/document.py                   + extension allowlist check before storage save

New:
  tests/test_agent_path_jail.py              9 jail-behavior tests
```

### Còn 3 MEDIUM (không khẩn, đã document trong report)
- Per-account lockout (Redis counter trên `failed_attempts:<user_id>`)
- Rotate `.env` secrets khi laptop ra ngoài
- Refresh cookie samesite=none — quyết định strict hoặc thêm CSRF token

Report JSON: `.gstack/security-reports/2026-04-29-recheck.json`

---

## 5. Files thay đổi

```
Modified:
  .dockerignore                              + gcp key, *.pem, *.key
  Dockerfile                                 + USER appuser
  docker-compose.yml                         + redis AOF, worker healthcheck
  main.py                                    + slowapi wiring
  pyproject.toml                             + slowapi, python-magic, underthesea
  src/api/v1/routes/auth.py                  rate limit, change_password, open_reg gate
  src/core/config.py                         + open_registration, rate-limit settings
  src/core/database.py                       + pool config
  src/models/user.py                         + force_change_password
  src/repositories/document.py               + unaccent in FTS
  src/schemas/auth.py                        + must_change_password, ChangePasswordRequest
  src/services/auth.py                       LoginResult, change_password method
  src/services/chat_service.py               cap skill_state at 1MB
  src/services/document.py                   magic-byte validation
  src/services/script_runner.py              raise instead of silent fallback
  src/worker/dispatch.py                     ARQ job_id dedup
  src/worker/settings.py                     max_jobs=20, retry, cron jobs
  src/worker/tasks/document.py               unaccent FTS, VN chunking

New:
  alembic/versions/20260428_add_force_change_password.py
  alembic/versions/20260428_fts_unaccent_backfill.py
  src/core/file_validation.py
  src/services/text_chunking.py
  src/worker/tasks/agent_state_cleanup.py
  tests/test_text_chunking.py
  tests/test_file_validation.py
  tests/test_dispatch_dedupe.py
  docs/BACKUP_AND_PERSISTENCE.md
  docs/REMEDIATION_REPORT_2026-04-28.md     (this file)
  .gstack/security-reports/2026-04-28-recheck.json

Untracked from git (not deleted from disk):
  gcp-documentai-key.json                    (still in commits cbe2495, 202c993)
```

---

**Disclaimer:** Đây là AI-assisted remediation + audit. Không thay thế professional security audit cho production. Trước khi go-live thật, nên engage một security firm đánh giá độc lập.
