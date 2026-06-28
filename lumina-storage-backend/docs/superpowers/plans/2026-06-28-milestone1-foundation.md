# Milestone 1 — Foundation (Phase 0 + Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng lưới an toàn test reproducible + chuẩn hóa nền platform (secret guard, tách khóa, structlog, correlation-id, readiness, DI providers) làm bệ phóng cho các phase refactor sau.

**Architecture:** Test chạy trong Docker (stage `test` có dev deps) trỏ Postgres test riêng; mỗi thay đổi platform đi kèm test TDD; không đụng business logic. App luôn chạy sau mỗi task.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, pytest + pytest-asyncio + pytest-cov, structlog, asgi-correlation-id, cryptography(Fernet), python-jose(JWT).

## Global Constraints
- Python `>=3.11` (container chạy 3.13); không hạ floor.
- Mọi commit theo Conventional Commits, **KHÔNG push**.
- KHÔNG đổi semantics `/health` liveness hiện có (`{"status":"ok","version":"1.0.0"}`).
- Test DB tách biệt: `lumina_driver_test` trên PostgreSQL 18 @ `127.0.0.1:5433` (user `postgres`/`postgres`).
- Mỗi task kết thúc bằng checkpoint: `verification-before-completion` → `/review` → `/codex` (codex sau review).
- TDD bắt buộc: RED → GREEN → REFACTOR.

---

## File Structure (Milestone 1)
- `lumina-storage-backend/Dockerfile` — thêm stage `test` (builder + dev deps).
- `docker-compose.yml` — thêm service `test` (profile `test`).
- `lumina-storage-backend/pyproject.toml` — thêm dev deps: pytest-cov, respx, fakeredis, structlog, asgi-correlation-id.
- `lumina-storage-backend/tests/smoke/test_smoke_api.py` — smoke E2E (mới).
- `lumina-storage-backend/src/core/config.py` — thêm `encryption_key`, guard helper.
- `lumina-storage-backend/src/core/encryption.py` — dùng `encryption_key` (fallback secret_key + warn).
- `lumina-storage-backend/src/core/logging.py` — structlog config (mới).
- `lumina-storage-backend/src/core/middleware.py` — correlation-id (mới, nếu không dùng lib).
- `lumina-storage-backend/main.py` — gọi guard + logging + middleware ở `create_app`/`lifespan`.
- `lumina-storage-backend/src/api/v1/routes/health.py` — thêm `/health/ready`.
- `lumina-storage-backend/src/api/providers.py` — DI providers (mới).
- `lumina-storage-backend/tests/core/`, `tests/api/` — test mới tương ứng.

---

## PHASE 0 — Lưới an toàn

### Task 0.1: Test runner reproducible (Docker stage + compose service + dev deps)

**Files:**
- Modify: `lumina-storage-backend/pyproject.toml` (dependency-groups.dev)
- Modify: `lumina-storage-backend/Dockerfile` (thêm stage `test`)
- Modify: `docker-compose.yml` (service `test`, profile)
- Create: `lumina-storage-backend/tests/__init__.py` (nếu thiếu — đã có)

**Interfaces:**
- Produces: lệnh `docker compose run --rm test` chạy pytest; biến `TEST_DATABASE_URL`.

- [ ] **Step 1: Thêm dev deps** vào `pyproject.toml` `[dependency-groups] dev`:
```toml
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.23.0",
    "pytest-cov>=5.0.0",
    "respx>=0.21.0",
    "fakeredis>=2.23.0",
    "httpx>=0.27.0",
    "jupyter>=1.1.1",
    "ipykernel>=7.2.0",
]
```

- [ ] **Step 2: Thêm stage `test` vào Dockerfile** (sau stage builder, trước/ngoài runtime). Tái dùng builder có `uv`:
```dockerfile
# ── Test stage (dev deps + source, chạy pytest) ───────────────────────────
FROM builder AS test
WORKDIR /app
RUN uv sync --frozen   # gồm dev group (bỏ --no-dev)
COPY . .
ENV PYTHONUNBUFFERED=1
CMD ["uv", "run", "pytest", "-q"]
```
> Nếu builder không đặt tên `builder`, đọc Dockerfile và đặt `AS builder` cho stage build hiện có.

- [ ] **Step 3: Thêm service `test`** vào `docker-compose.yml`:
```yaml
  test:
    profiles: ["test"]
    build:
      context: ./lumina-storage-backend
      dockerfile: Dockerfile
      target: test
    environment:
      TEST_DATABASE_URL: postgresql+asyncpg://postgres:postgres@host.docker.internal:5433/lumina_driver_test
      REDIS_HOST: redis
      REDIS_PORT: 6379
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      postgres:
        condition: service_healthy
```
> Test DB nằm trên PG18 host @5433 (theo chuẩn dự án), truy cập từ container qua `host.docker.internal`.

- [ ] **Step 4: Tạo DB test** (một lần):
```bash
PGPASSWORD=postgres "/c/Program Files/PostgreSQL/18/bin/psql" -h 127.0.0.1 -p 5433 -U postgres -c "CREATE DATABASE lumina_driver_test;" 2>/dev/null || echo "DB đã tồn tại"
```
Expected: `CREATE DATABASE` hoặc "đã tồn tại".

- [ ] **Step 5: Build + smoke chạy collector** (xác nhận harness hoạt động):
```bash
cd /c/Lumina_Storage && docker compose build test
docker compose run --rm test uv run pytest --collect-only -q
```
Expected: liệt kê test items, không lỗi import.

- [ ] **Step 6: Commit**
```bash
git add lumina-storage-backend/pyproject.toml lumina-storage-backend/Dockerfile docker-compose.yml
git commit -m "test: add reproducible docker test runner with dev deps"
```

### Task 0.2: Baseline — suite hiện có XANH

**Files:** không sửa code; chạy verify.

- [ ] **Step 1: Chạy full suite**
```bash
cd /c/Lumina_Storage && docker compose run --rm test uv run pytest -q
```
Expected: tất cả PASS (hoặc ghi nhận test fail có sẵn → tạo issue, KHÔNG sửa trong task này).

- [ ] **Step 2: Lưu baseline coverage**
```bash
docker compose run --rm test uv run pytest --cov=src --cov-report=term-missing -q | tail -30
```
Expected: in % coverage baseline.

- [ ] **Step 3: Ghi baseline** vào `docs/superpowers/plans/_baseline.md` (số test pass, coverage %). Commit.
```bash
git add lumina-storage-backend/docs/superpowers/plans/_baseline.md
git commit -m "test: record baseline pass count and coverage"
```

### Task 0.3: Smoke test E2E (đèn xanh tổng)

**Files:**
- Create: `lumina-storage-backend/tests/smoke/test_smoke_api.py`
- Create: `lumina-storage-backend/tests/smoke/__init__.py`

**Interfaces:**
- Consumes: fixtures `async_client`, `superuser`, `admin_headers` (conftest.py).

- [ ] **Step 1: Viết smoke test** (health + auth/me chain):
```python
# tests/smoke/test_smoke_api.py
import pytest

pytestmark = pytest.mark.asyncio


async def test_health_liveness(async_client):
    r = await async_client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_auth_me_with_token(async_client, superuser, admin_headers):
    r = await async_client.get("/api/v1/auth/me", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == str(superuser.id)
    assert body["username"] == superuser.username
```

- [ ] **Step 2: Chạy — verify PASS**
```bash
docker compose run --rm test uv run pytest tests/smoke/test_smoke_api.py -v
```
Expected: 2 PASS.

- [ ] **Step 3: Commit**
```bash
git add lumina-storage-backend/tests/smoke/
git commit -m "test: add E2E smoke tests (health + auth chain)"
```

### Task 0.4: git tag điểm khôi phục

- [ ] **Step 1: Tag**
```bash
cd /c/Lumina_Storage && git tag pre-refactor && git tag -l | grep pre-refactor
```
Expected: in `pre-refactor`.

---

## PHASE 1 — Nền platform

### Task 1.1: SECRET_KEY guard ở startup (TDD)

**Files:**
- Modify: `lumina-storage-backend/src/core/config.py`
- Modify: `lumina-storage-backend/main.py` (gọi guard trong `create_app`)
- Test: `lumina-storage-backend/tests/core/test_secret_guard.py`

**Interfaces:**
- Produces: `validate_secrets(settings) -> None` (raise `RuntimeError` khi production + placeholder).

- [ ] **Step 1: Viết test RED**
```python
# tests/core/test_secret_guard.py
import pytest
from src.core.config import Settings, validate_secrets


def test_guard_raises_on_placeholder_in_production():
    s = Settings(app_env="production", secret_key="changeme")
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        validate_secrets(s)


def test_guard_raises_on_short_secret_in_production():
    s = Settings(app_env="production", secret_key="short")
    with pytest.raises(RuntimeError):
        validate_secrets(s)


def test_guard_passes_in_development_with_placeholder():
    s = Settings(app_env="development", secret_key="changeme")
    validate_secrets(s)  # chỉ warn, không raise


def test_guard_passes_with_strong_secret():
    s = Settings(app_env="production", secret_key="x" * 40)
    validate_secrets(s)
```

- [ ] **Step 2: Run — verify FAIL**
```bash
docker compose run --rm test uv run pytest tests/core/test_secret_guard.py -v
```
Expected: FAIL — `cannot import name 'validate_secrets'`.

- [ ] **Step 3: Implement** trong `src/core/config.py` (cuối file, trước `get_settings`):
```python
import logging

_PLACEHOLDER_SECRETS = {"changeme", "your-secret-key-here", ""}


def validate_secrets(settings: "Settings") -> None:
    """Fail-fast nếu production dùng secret yếu/placeholder. Dev chỉ cảnh báo."""
    weak = settings.secret_key in _PLACEHOLDER_SECRETS or len(settings.secret_key) < 32
    if not weak:
        return
    msg = "SECRET_KEY là placeholder hoặc quá ngắn (<32). Sinh: python -c \"import secrets;print(secrets.token_urlsafe(32))\""
    if settings.app_env == "production":
        raise RuntimeError(msg)
    logging.getLogger(__name__).warning("[config] %s", msg)
```

- [ ] **Step 4: Run — verify PASS**
```bash
docker compose run --rm test uv run pytest tests/core/test_secret_guard.py -v
```
Expected: 4 PASS.

- [ ] **Step 5: Gọi guard trong `main.py` `create_app`** (ngay sau `settings = get_settings()` dòng 80):
```python
    from src.core.config import validate_secrets
    validate_secrets(settings)
```

- [ ] **Step 6: Verify app vẫn khởi động** (dev secret thật ≥32 ký tự → không raise):
```bash
docker compose restart app && sleep 8 && curl -s http://localhost:1690/api/v1/health
```
Expected: `{"status":"ok",...}`.

- [ ] **Step 7: Commit**
```bash
git add lumina-storage-backend/src/core/config.py lumina-storage-backend/main.py lumina-storage-backend/tests/core/test_secret_guard.py
git commit -m "feat(security): fail-fast guard for weak SECRET_KEY in production"
```

### Task 1.2: Tách ENCRYPTION_KEY khỏi SECRET_KEY (TDD)

**Files:**
- Modify: `lumina-storage-backend/src/core/config.py` (thêm `encryption_key`)
- Modify: `lumina-storage-backend/src/core/encryption.py` (`_get_fernet` dùng encryption_key)
- Modify: `.env.example` (cả root + backend) — thêm `ENCRYPTION_KEY=`
- Test: `lumina-storage-backend/tests/core/test_encryption_key.py`

**Interfaces:**
- Consumes: `encrypt_value`/`decrypt_value` (encryption.py).
- Produces: `Settings.encryption_key: str`; round-trip dùng encryption_key.

- [ ] **Step 1: Viết test RED**
```python
# tests/core/test_encryption_key.py
import importlib


def test_roundtrip_uses_encryption_key(monkeypatch):
    monkeypatch.setenv("ENCRYPTION_KEY", "k" * 40)
    monkeypatch.setenv("SECRET_KEY", "s" * 40)
    from src.core import config, encryption
    config.get_settings.cache_clear()
    importlib.reload(encryption)
    enc = encryption.encrypt_value("hello-secret")
    assert enc.startswith("enc:")
    assert encryption.decrypt_value(enc) == "hello-secret"


def test_encryption_independent_of_secret_key(monkeypatch):
    monkeypatch.setenv("ENCRYPTION_KEY", "k" * 40)
    monkeypatch.setenv("SECRET_KEY", "s" * 40)
    from src.core import config, encryption
    config.get_settings.cache_clear()
    importlib.reload(encryption)
    enc = encryption.encrypt_value("data")
    # đổi SECRET_KEY không ảnh hưởng giải mã (vì dùng ENCRYPTION_KEY riêng)
    monkeypatch.setenv("SECRET_KEY", "different" * 5)
    config.get_settings.cache_clear()
    importlib.reload(encryption)
    assert encryption.decrypt_value(enc) == "data"
```

- [ ] **Step 2: Run — verify FAIL**
```bash
docker compose run --rm test uv run pytest tests/core/test_encryption_key.py -v
```
Expected: FAIL (chưa có encryption_key; test 2 fail vì hiện dùng secret_key).

- [ ] **Step 3: Thêm field vào `config.py`** (sau `secret_key`, dòng 11):
```python
    encryption_key: str = ""  # khóa Fernet riêng cho mã hóa data; trống → fallback secret_key (cảnh báo)
```

- [ ] **Step 4: Sửa `encryption.py` `_get_fernet`**:
```python
def _get_fernet() -> Fernet:
    """Derive Fernet key từ ENCRYPTION_KEY (fallback SECRET_KEY nếu trống)."""
    settings = get_settings()
    base = settings.encryption_key or settings.secret_key
    if not settings.encryption_key:
        import logging
        logging.getLogger(__name__).warning(
            "[encryption] ENCRYPTION_KEY trống — đang fallback SECRET_KEY. Đặt ENCRYPTION_KEY riêng cho production."
        )
    digest = hashlib.sha256(base.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)
```

- [ ] **Step 5: Run — verify PASS**
```bash
docker compose run --rm test uv run pytest tests/core/test_encryption_key.py -v
```
Expected: 2 PASS.

- [ ] **Step 6: Thêm `ENCRYPTION_KEY=` vào 2 file `.env.example`** + sinh giá trị thật vào `.env` đang chạy:
```bash
cd /c/Lumina_Storage
grep -q "ENCRYPTION_KEY" .env || { echo "ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")" >> .env; }
docker compose restart app worker
```

- [ ] **Step 7: Commit**
```bash
git add lumina-storage-backend/src/core/config.py lumina-storage-backend/src/core/encryption.py lumina-storage-backend/.env.example .env.example lumina-storage-backend/tests/core/test_encryption_key.py
git commit -m "feat(security): split ENCRYPTION_KEY from SECRET_KEY (Fernet)"
```

### Task 1.3: structlog JSON logging

**Files:**
- Create: `lumina-storage-backend/src/core/logging.py`
- Modify: `lumina-storage-backend/main.py` (gọi `configure_logging()` đầu `create_app`)
- Test: `lumina-storage-backend/tests/core/test_logging.py`

**Interfaces:**
- Produces: `configure_logging() -> None`; `get_logger(name) -> structlog.BoundLogger`.

- [ ] **Step 1: Viết test RED**
```python
# tests/core/test_logging.py
def test_configure_and_log_json(capsys):
    from src.core.logging import configure_logging, get_logger
    configure_logging()
    log = get_logger("test")
    log.info("hello", foo="bar")
    out = capsys.readouterr().out
    assert "hello" in out and "foo" in out
```

- [ ] **Step 2: Run — verify FAIL** (module chưa có).
```bash
docker compose run --rm test uv run pytest tests/core/test_logging.py -v
```

- [ ] **Step 3: Implement `src/core/logging.py`**:
```python
import logging
import structlog


def configure_logging() -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = "app"):
    return structlog.get_logger(name)
```
> Thêm `structlog>=24.1.0` vào dev+main deps (main vì runtime dùng).

- [ ] **Step 4: Thêm `structlog` vào `[project] dependencies`** trong pyproject.toml; rebuild test image.

- [ ] **Step 5: Run — verify PASS**.

- [ ] **Step 6: Gọi `configure_logging()` đầu `create_app`** (dòng 78, trước `FastAPI(...)`).

- [ ] **Step 7: Commit**
```bash
git add lumina-storage-backend/src/core/logging.py lumina-storage-backend/main.py lumina-storage-backend/pyproject.toml lumina-storage-backend/tests/core/test_logging.py
git commit -m "feat(obs): structured JSON logging via structlog"
```

### Task 1.4: Correlation-ID middleware (TDD)

**Files:**
- Modify: `lumina-storage-backend/main.py` (add middleware)
- Modify: `lumina-storage-backend/pyproject.toml` (`asgi-correlation-id>=4.3.0`)
- Test: `lumina-storage-backend/tests/api/test_correlation_id.py`

**Interfaces:**
- Produces: response header `X-Request-ID` trên mọi request.

- [ ] **Step 1: Viết test RED**
```python
# tests/api/test_correlation_id.py
import pytest
pytestmark = pytest.mark.asyncio


async def test_response_has_request_id(async_client):
    r = await async_client.get("/api/v1/health")
    assert r.headers.get("X-Request-ID")


async def test_request_id_echoed_when_provided(async_client):
    r = await async_client.get("/api/v1/health", headers={"X-Request-ID": "abc-123"})
    assert r.headers.get("X-Request-ID") == "abc-123"
```

- [ ] **Step 2: Run — verify FAIL**.

- [ ] **Step 3: Thêm middleware trong `create_app`** (sau CORS, dòng 88):
```python
    from asgi_correlation_id import CorrelationIdMiddleware
    app.add_middleware(CorrelationIdMiddleware, header_name="X-Request-ID")
```
> Bind vào structlog: thêm processor `merge_contextvars` (đã có ở 1.3) + cấu hình asgi-correlation-id ghi vào contextvars (mặc định có).

- [ ] **Step 4: Run — verify PASS**.

- [ ] **Step 5: Commit**
```bash
git add lumina-storage-backend/main.py lumina-storage-backend/pyproject.toml lumina-storage-backend/tests/api/test_correlation_id.py
git commit -m "feat(obs): correlation-id middleware (X-Request-ID)"
```

### Task 1.5: /health/ready readiness probe (TDD)

**Files:**
- Modify: `lumina-storage-backend/src/api/v1/routes/health.py`
- Test: `lumina-storage-backend/tests/api/test_health_ready.py`

**Interfaces:**
- Consumes: `get_db` (DB ping), settings (redis/qdrant URL).
- Produces: `GET /health/ready` → 200 `{"db":true,...}` khi ổn; 503 khi một dependency lỗi. KHÔNG đổi `/health`.

- [ ] **Step 1: Viết test RED**
```python
# tests/api/test_health_ready.py
import pytest
pytestmark = pytest.mark.asyncio


async def test_ready_ok_when_db_up(async_client):
    r = await async_client.get("/api/v1/health/ready")
    assert r.status_code == 200
    assert r.json()["db"] is True


async def test_liveness_unchanged(async_client):
    r = await async_client.get("/api/v1/health")
    assert r.json() == {"status": "ok", "version": "1.0.0"}
```

- [ ] **Step 2: Run — verify FAIL** (ready chưa có).

- [ ] **Step 3: Implement** trong `health.py`:
```python
from fastapi import Depends, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from src.core.database import get_db


@router.get("/health/ready")
async def readiness(response: Response, db: AsyncSession = Depends(get_db)) -> dict:
    checks = {"db": False}
    try:
        await db.execute(text("SELECT 1"))
        checks["db"] = True
    except Exception:
        checks["db"] = False
    if not all(checks.values()):
        response.status_code = 503
    return checks
```
> Bản đầu chỉ check DB (đủ cho readiness cơ bản); Redis/Qdrant thêm ở task mở rộng sau, không bắt buộc Milestone 1.

- [ ] **Step 4: Run — verify PASS** (db_session override → SELECT 1 OK).

- [ ] **Step 5: Verify live**
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:1690/api/v1/health/ready
```
Expected: 200.

- [ ] **Step 6: Commit**
```bash
git add lumina-storage-backend/src/api/v1/routes/health.py lumina-storage-backend/tests/api/test_health_ready.py
git commit -m "feat(obs): /health/ready readiness probe (DB check)"
```

### Task 1.6: api/providers.py — DI cho service (TDD)

**Files:**
- Create: `lumina-storage-backend/src/api/providers.py`
- Modify: `lumina-storage-backend/main.py` (SkillService → `app.state` thay singleton module-global)
- Test: `lumina-storage-backend/tests/api/test_providers.py`

**Interfaces:**
- Produces: `get_skill_service(request) -> SkillService` (đọc `request.app.state.skill_service`); pattern provider để route dùng `Depends(get_skill_service)`.

- [ ] **Step 1: Viết test RED**
```python
# tests/api/test_providers.py
import pytest
pytestmark = pytest.mark.asyncio


async def test_skill_service_provider_returns_state_instance(async_client):
    # smoke: route gọi provider không lỗi 500
    r = await async_client.get("/api/v1/health/ready")
    assert r.status_code in (200, 503)
```
> (Provider thực được khẳng định mạnh hơn khi route đầu tiên migrate sang nó; ở task này chỉ tạo provider + chuyển SkillService sang app.state, giữ tương thích getter cũ.)

- [ ] **Step 2: Implement `src/api/providers.py`**:
```python
from fastapi import Request
from src.services.skill_service import SkillService


def get_skill_service(request: Request) -> SkillService:
    svc = getattr(request.app.state, "skill_service", None)
    if svc is None:
        raise RuntimeError("SkillService chưa khởi tạo (app chưa start?)")
    return svc
```

- [ ] **Step 3: Sửa `main.py` lifespan** — gán vào app.state (giữ getter cũ tương thích):
```python
    _skill_service = SkillService(settings)
    app.state.skill_service = _skill_service
```

- [ ] **Step 4: Run suite liên quan — verify PASS** (không gãy import/khởi động).
```bash
docker compose run --rm test uv run pytest tests/api/ -v
```

- [ ] **Step 5: Commit**
```bash
git add lumina-storage-backend/src/api/providers.py lumina-storage-backend/main.py lumina-storage-backend/tests/api/test_providers.py
git commit -m "refactor(di): add api/providers + SkillService on app.state"
```

---

## Checkpoint mỗi task (BẮT BUỘC)
Sau mỗi Task ở trên: `verification-before-completion` (chạy lại test + xác nhận output) → `/review` (review diff) → `/codex` (review chéo, sau /review). Lỗi → systematic-debugging + /investigate, fix tận gốc.

## Checkpoint Milestone 1 (sau Task 1.6)
`/plan-eng-review` đối chiếu code với spec gốc `~/.claude/plans/chu-n-h-a-l-i-to-n-serene-blanket.md` (Phase 0 + Phase 1). Lệch → báo cáo + quay lại. Sau đó: **báo cáo Word hoàn thành Milestone 1** (chi tiết từng chỉnh sửa + lý do) theo quy ước.

## Verification end-to-end (Milestone 1)
- `docker compose run --rm test uv run pytest -q` → toàn bộ xanh + coverage ≥ baseline.
- `curl http://localhost:1690/api/v1/health` → liveness 200 không đổi.
- `curl -w "%{http_code}" http://localhost:1690/api/v1/health/ready` → 200.
- App log ra JSON có `request_id`; response có header `X-Request-ID`.
- Đặt `APP_ENV=production` + `SECRET_KEY=changeme` → app raise lúc khởi động (test thủ công container tạm).
