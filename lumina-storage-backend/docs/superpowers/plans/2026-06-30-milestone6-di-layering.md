# Phase 6 — DI route + siết layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Mỗi task STRICT: TDD (RED→GREEN) → full suite → /review → /codex → fix → commit (Conventional Commits, KHÔNG push).
> Spec gốc §Phase 6: `~/.claude/plans/chu-n-h-a-l-i-to-n-serene-blanket.md`. *Done: import-linter xanh.*

## Context

Sau Phase 1-5, kiến trúc đã có tầng rõ (api → services → repositories → models; core/schemas shared) nhưng còn **rò rỉ tầng**: vài route gọi THẲNG repository (bỏ qua service) và 1 service import NGƯỢC lên api layer. Phase 6 siết lại: route chỉ gọi service (qua DI), service không biết api, và **import-linter** chặn vi phạm tự động (Done = import-linter xanh) → ngăn rò rỉ tái phát. Không đổi hành vi (pure refactor); full suite phải xanh y nguyên.

**Inventory (agent-verified):**
- **Route→repo (6 điểm):** `auth.py:128` (UserRepository.get_by_id_with_permissions), `users.py:222` (GroupRepository.get_auto_group_by_role), `storage.py:32` (StorageConfigRepository.get_default), `generator.py` (~12 call GeneratorSessionRepository + GeneratorSessionVersionRepository — CHƯA có service), `documents.py:443` (GeneratorSessionRepository.count_draft_by_template).
- **Service→api (1 điểm):** `services/user.py:6` `from src.api.deps import is_admin` (reverse-dep).
- **import-linter:** CHƯA cài; root package `src`; chưa có config/CI.
- **DI hiện có:** `api/providers.py` (get_skill_service singleton); route đa số dùng inline `_svc(db=Depends(get_db))`.

## Global Constraints

- Chạy test từ ROOT `c:\Lumina_Storage`: `docker compose --profile test run --rm test uv run pytest <path> -q`. Baseline **357 passed**, migration head `20260629a001`/`20260629b001`.
- Thêm dep → `cd lumina-storage-backend && uv lock` + `docker compose --profile test build test`.
- **PURE REFACTOR** — KHÔNG đổi hành vi/response; full suite phải xanh nguyên. Comment tiếng Việt; commit per task, KHÔNG push.
- Mỗi task STRICT (TDD→suite→/review→/codex→fix→commit).
- **Lưu ý infra:** docker restart thô làm postgres suy yếu → `docker compose restart postgres redis` nếu full-suite ProgrammingError leo thang.

## What already exists (tái dùng)

- `api/providers.py` (get_skill_service). DI inline pattern: `def _svc(db=Depends(get_db)) -> XService: return XService(db)` (ai_model_config/extraction_provider/storage/users/documents).
- Services wrap repo sẵn: UserService/AuthService/GroupService/StorageConfigService/DocumentService... (chỉ thiếu GeneratorService + vài method expose).
- BaseRepository pattern; repo no-commit (boundary get_db).

## File Structure

- Create: `src/core/authz.py` (is_admin di chuyển khỏi api.deps); `src/services/generator_service.py` (GeneratorService wrap 2 generator repo). `.importlinter` (hoặc `[tool.importlinter]` trong pyproject) + `tests/test_import_linter.py`.
- Modify: `src/api/deps.py` (import is_admin từ core), `src/services/user.py` (import từ core — fix reverse-dep); `src/services/user.py`/`group.py`/`storage_config service` (expose method nếu thiếu); routes auth.py/users.py/storage.py/generator.py/documents.py (route→service); `api/providers.py` (get_generator_service); `pyproject.toml` (import-linter dev dep).

---

### Task 1: Fix reverse-dep — di chuyển `is_admin` ra `src/core/authz.py`

**Vấn đề:** `src/services/user.py:6` import `from src.api.deps import is_admin` → service phụ thuộc NGƯỢC lên api. `is_admin(user)` là logic thuần (đọc user.roles), không thuộc HTTP.

**Files:** Create `src/core/authz.py`; Modify `src/api/deps.py` (định nghĩa is_admin → import từ core, giữ require_admin/get_current_user ở deps), `src/services/user.py` (import từ core). Test `tests/test_authz.py`.

```python
# src/core/authz.py
from src.models.user import User
def is_admin(user: User) -> bool:
    """User có role mặc định (admin)? Logic thuần — dùng cả api.deps lẫn service."""
    return any(ur.role.is_default for ur in user.roles if ur.role is not None)
```

- [ ] **Step 1 RED** test_authz.py: is_admin(user có role is_default) True; không có → False (dựng User + Role/UserRole in-memory hoặc db_session).
- [ ] **Step 2-3 GREEN** tạo core/authz.py; api/deps.py `from src.core.authz import is_admin` (bỏ định nghĩa cũ, giữ require_admin dùng nó); services/user.py `from src.core.authz import is_admin`.
- [ ] **Step 4** full suite (auth/admin tests xanh). **Step 5 commit** `refactor(core): di chuyển is_admin ra core/authz (fix service→api reverse-dep, T1 P6)`.

---

### Task 2: GeneratorService (NEW) — gỡ ~12 route→repo trong generator.py + documents.py

**Vấn đề:** generator.py route gọi THẲNG GeneratorSessionRepository + GeneratorSessionVersionRepository (~12 chỗ: 1574/1597/1637/1667/1683/1900/1921/1926/1956/1961/1978/1983/2004/2009/2128/2180); documents.py:443 gọi count_draft_by_template. Chưa có GeneratorService.

**Files:** Create `src/services/generator_service.py`; Modify `generator.py` + `documents.py` (route→service qua DI); `api/providers.py` (get_generator_service). Test `tests/services/test_generator_service.py`.

**GeneratorService:** wrap 2 repo, expose method tương ứng MỖI call hiện tại (create_session/list_sessions_for_user/get_session_for_user/update_session/delete_session/create_version/list_versions/get_version_for_user/update_version/delete_version/count_drafts_by_template...). KHÔNG commit (boundary). Giữ NGUYÊN logic (chỉ chuyển repo-call vào service method 1-1).

- [ ] **Step 1 RED** test_generator_service.py: tạo session + version qua service (db_session), assert đọc lại được; count_drafts_by_template đúng. (Service method 1-1 với repo → test happy-path mỗi method nhóm.)
- [ ] **Step 2-3 GREEN** viết GeneratorService (mỗi method gọi repo tương ứng). `get_generator_service` DI. Thay MỌI `GeneratorSessionRepository(db)`/`GeneratorSessionVersionRepository(db)` trong generator.py + documents.py bằng `svc: GeneratorService = Depends(get_generator_service)` + `svc.method(...)`. Bỏ import repo khỏi 2 route.
- [ ] **Step 4** full suite (generator UoW + e2e tests xanh — pure refactor). **Step 5 commit** `refactor(generator): GeneratorService gỡ route→repo generator+documents (T2 P6)`.

---

### Task 3: Route→service cho auth.py / users.py / storage.py (3 điểm còn lại)

**3 method service PHẢI tạo (critique xác nhận đều CHƯA có):**
- `UserService.get_user_with_permissions(user_id) -> User` (wrap UserRepository.get_by_id_with_permissions) → auth.py:128.
- `GroupService.get_auto_group_by_role(role_id) -> Group | None` → users.py:222.
- `StorageConfigService.get_upload_limits() -> dict` (gói trọn get_default + `_resolve_max_upload_size_mb` — bỏ nested-import private internals khỏi route, P2 critique) → storage.py:32.

**Files:** Modify `services/user.py`, `services/group.py`, `services/storage_config_service` (3 method trên); routes auth.py:128 / users.py:222 / storage.py:32 (→ service qua DI, bỏ import repo + private internals). Test method mới.

- [ ] **Step 1 RED** test method service mới (get_user_with_permissions, get_auto_group_by_role) trả đúng (db_session seed).
- [ ] **Step 2-3 GREEN** expose method service (1-1 repo); thay 3 route-call bằng service (DI provider hoặc inline _svc). Bỏ import repo khỏi 3 route.
- [ ] **Step 4** full suite. **Step 5 commit** `refactor(api): route→service cho auth/users/storage (gỡ route→repo, T3 P6)`.

---

### Task 4: import-linter — contracts chặn route→repo & service→api + gate

**Files:** `pyproject.toml` (dev dep `import-linter` + `[tool.importlinter]` contracts), `tests/test_import_linter.py` (chạy lint-imports trong pytest → gate). uv lock + rebuild test.

**Contracts — CHỈ 2 forbidden-contract (quyết định upfront từ critique, đúng y spec "chặn route→repo & service→api"):**
```toml
[tool.importlinter]
root_package = "src"

[[tool.importlinter.contracts]]
name = "Routes must not import repositories"
type = "forbidden"
source_modules = ["src.api.v1.routes"]
forbidden_modules = ["src.repositories"]

[[tool.importlinter.contracts]]
name = "Services must not import api"
type = "forbidden"
source_modules = ["src.services"]
forbidden_modules = ["src.api"]
```
**KHÔNG dùng `layers` contract** (P0 từ critique): `src/api/deps.py` import UserRepository (SSO user-provisioning HỢP LỆ), `src/worker` + `src/extraction/selector.py` cross-layer repo/service (composition-root HỢP LỆ) → layers-contract sẽ đỏ giả. Spec chỉ yêu cầu 2 rule này. `source_modules=["src.api.v1.routes"]` (KHÔNG phải cả `src.api`) → deps.py không vướng.

- [ ] **Step 1** thêm import-linter dev dep + uv lock + rebuild test.
- [ ] **Step 2 RED→GREEN** viết contracts; chạy `uv run lint-imports` → phải XANH (T1-T3 đã gỡ hết vi phạm). Nếu layers-contract đỏ do peripheral → giữ 2 forbidden-contracts cốt lõi.
- [ ] **Step 3** test_import_linter.py: subprocess `lint-imports` exit 0 (gate trong pytest) — hoặc gọi importlinter API. RED nếu còn vi phạm.
- [ ] **Step 4** full suite + lint-imports xanh. **Step 5 commit** `chore(arch): import-linter chặn route→repo & service→api (T4 P6)`.

---

### Task 5: Checkpoint Phase 6

- [ ] Full suite + smoke (app boot, worker import) + `uv run lint-imports` xanh.
- [ ] Alignment audit (route→repo = 0; service→api = 0; import-linter gate xanh) đối chiếu spec.
- [ ] Báo cáo Word `docs/Lumina_Storage_Milestone6_*.docx`.
- [ ] Commit `test(arch): checkpoint Phase 6 (import-linter xanh)`.

## NOT in scope

- Di chuyển TOÀN BỘ route sang centralized providers (Phase 7 cleanup) — Phase 6 chỉ gỡ vi phạm + DI cho route vi phạm.
- Tách god-service (agent.py/chat_service.py) — Phase 7.
- GitHub Actions CI — chưa có; gate qua pytest/test image là đủ cho Done.

## Verification

1. `docker compose --profile test run --rm test uv run pytest -q` — full suite xanh (pure refactor, 357+).
2. `docker compose --profile test run --rm test uv run lint-imports` — exit 0 (Done criterion).
3. grep `src/api/v1/routes/` cho `from src.repositories` = 0; grep `src/services/` cho `from src.api` = 0.
4. Smoke: app boot + worker import OK (route DI không vỡ).
5. Báo cáo Word Milestone 6.

## GSTACK REVIEW REPORT (outside-voice critique — đã resolve)

- **P0 #1+#7 (layers contract đỏ giả):** RESOLVED — bỏ layers-contract, CHỈ 2 forbidden-contract (route↛repo, service↛api) đúng spec. deps.py→UserRepository (SSO) + worker/extraction cross-layer là HỢP LỆ, không vi phạm 2 rule này (route scope `src.api.v1.routes`, không phải cả `src.api`).
- **P1 #2 (GeneratorService không phải 1-1):** ACCEPTED scope — Phase 6 chỉ gỡ ROUTE→REPO (thay `Repo(db).m()` bằng `svc.m()` 1-1 repo-call). Business-logic (field merge, docx edit, version labeling) GIỮ trong route (không phải repo-access → không vi phạm contract); trích vào service = Phase 7 god-route cleanup.
- **P1 #3 (tasks.py import is_admin):** RESOLVED — tasks.py → `from src.core.authz import is_admin` (T1).
- **P1 #5 (3 method chưa tồn tại):** RESOLVED — liệt kê tường minh 3 method ở T3 + TDD RED trước.
- **P1 #9 (backward compat is_admin):** RESOLVED — deps.py `from src.core.authz import is_admin` (re-export) → `from src.api.deps import is_admin` cũ vẫn chạy.
- **P2 #4 (storage.py nested private import):** RESOLVED — gói vào `StorageConfigService.get_upload_limits()`.
- **P2 #6 (import-linter tooling):** ACCEPTED — T4 Step 1 cài + pin version + verify CLI đọc `[tool.importlinter]` TRƯỚC khi viết pytest gate.
- **P2 #8 (documents.py:443):** RESOLVED — T2 GeneratorService gói luôn count_draft_by_template; documents.py route gọi service.
- **P2 #10 (smoke chỉ boot):** ACCEPTED — checkpoint T5 thêm smoke gọi vài endpoint chính (verify DI wiring), ngoài full pytest suite.
