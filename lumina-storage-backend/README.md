# Lumina Storage Backend

FastAPI backend cho hệ thống quản lý tài liệu Lumina, hỗ trợ xử lý tài liệu AI và RAG (Retrieval-Augmented Generation).

## Tech Stack

- **Runtime:** Python 3.11+, [uv](https://docs.astral.sh/uv/) (package manager)
- **Framework:** FastAPI + Uvicorn (4 workers production)
- **Database:** PostgreSQL 14+ (async via asyncpg + SQLAlchemy 2.0)
- **Cache / Queue:** Redis 7+ (AOF persistence) + ARQ (async job queue, 20 max jobs)
- **Vector DB:** Qdrant
- **AI/LLM:** LiteLLM, LangChain, LangGraph, OpenAI-compatible APIs
- **Vietnamese NLP:** underthesea (sentence-aware chunking)
- **OCR / Document:** Gotenberg (PDF conversion), pymupdf, python-pptx, markitdown
- **Storage:** Local / S3-compatible / Google Drive (pluggable)
- **Auth:** JWT (HS256), bcrypt password hashing, slowapi rate limiting

## Yêu cầu hệ thống

| Công cụ | Version | Ghi chú |
|---------|---------|---------|
| Python | >= 3.11 | |
| uv | >= 0.4 | |
| PostgreSQL | >= 14 | Cần extension `unaccent` (xem mục dưới) |
| Redis | >= 7 | AOF persistence enabled |
| Qdrant | >= 1.9 | Cùng vector size với embedding model (3072 cho text-embedding-3-large) |
| Docker & Docker Compose | tùy chọn | Khuyến nghị cho production |
| libmagic | required | Cho file content validation (đã include trong Dockerfile) |

---

## Quick start (TL;DR)

```bash
# 1. DBA: tạo DB + bật extension (1 lần)
psql -c "CREATE EXTENSION IF NOT EXISTS unaccent;" lumina_driver_prod

# 2. Code + env
git clone <repo> && cd lumina-driver-backend
uv sync
cp .env.example .env  # sửa SECRET_KEY, DB_*, REDIS_*, QDRANT_*, CORS_ORIGINS

# 3. Migrate
uv run alembic upgrade head

# 4. Start
docker compose up -d  # OR: 3 terminals (uvicorn / arq / gotenberg)

# 5. Đọc hướng dẫn deploy chi tiết tại [docs/setup/deployment.md](docs/setup/deployment.md)
```

Đây là README tổng quan. Quy trình deploy cho khách hàng, cấu hình FE, và checklist vận hành nằm ở [docs/setup/deployment.md](docs/setup/deployment.md).

## Deploy lần đầu — checklist

Phần này được rút gọn để tránh trùng lặp. Xem hướng dẫn đầy đủ tại [docs/setup/deployment.md](docs/setup/deployment.md).

Tóm tắt:

1. Chuẩn bị PostgreSQL, Redis, Qdrant, và frontend/backend đã build.
2. Chạy migration và khởi động services.
3. Đăng nhập admin trên FE, đổi mật khẩu mặc định.
4. Vào `Settings → LLM Models` và `Settings → Storage` để cấu hình bắt buộc.
5. Upload thử một file để kiểm tra pipeline.

Nếu cần tài liệu đầy đủ từng bước, mở [docs/setup/deployment.md](docs/setup/deployment.md).

---

## Production hardening checklist

Trước khi mở cho người dùng cuối:

- [ ] `SECRET_KEY` đã đổi sang chuỗi random 32+ byte
- [ ] `APP_ENV=production` (kích hoạt fail-closed cho file_validation nếu thiếu libmagic)
- [ ] Admin password đã đổi khỏi `Admin@123` (self-registration đã được hardcode admin-only)
- [ ] `CORS_ORIGINS` chỉ chứa origin frontend thật, không có wildcard `*`
- [ ] Postgres và Qdrant không expose port ra public — chỉ accessible từ network nội bộ
- [ ] Backup pipeline chạy (xem `docs/BACKUP_AND_PERSISTENCE.md`)
- [ ] Rate limit auth endpoints đang có hiệu lực (login: 10/minute hardcoded ở `src/api/v1/routes/auth.py`)
- [ ] HTTPS reverse proxy (Nginx / Caddy / Traefik) trước app — vì refresh cookie dùng `samesite=none; secure=true` cần HTTPS
- [ ] Production secrets (Langfuse key, DB password, ...) inject qua deploy platform, **không** lưu file `.env` trên workstation cá nhân
- [ ] AI keys configure qua AI Model Config UI, **không** qua env vars

---

## Biến môi trường

Xem `.env.example` cho danh sách đầy đủ. Phần dưới chỉ liệt kê các nhóm chính.

### Application

| Biến | Mô tả | Mặc định |
|------|-------|----------|
| `APP_ENV` | `development` / `production`. Production sẽ fail-closed nếu thiếu libmagic | `development` |
| `SECRET_KEY` | JWT signing key. **BẮT BUỘC** đổi ở production | `changeme` |
| `CORS_ORIGINS` | JSON array origin frontend được phép | `["http://localhost:5173"]` |

> JWT lifetimes (`ACCESS_TOKEN_EXPIRE_MINUTES=30`, `REFRESH_TOKEN_EXPIRE_DAYS=7`) và login rate-limit (`10/minute`) là constants trong code (`src/core/security.py`, `src/api/v1/routes/auth.py`). Đổi ở đó nếu cần — không phải env var.

### Database (PostgreSQL)

| Biến | Mô tả |
|------|-------|
| `DB_HOST` | Host |
| `DB_PORT` | Port (default `5432`) |
| `DB_NAME` | Tên database |
| `DB_USER` | Username |
| `DB_PASSWORD` | Password |

Connection pool: `pool_size=20`, `max_overflow=30`, `pool_pre_ping=True`, `pool_recycle=3600s`.

### Redis

| Biến | Mô tả |
|------|-------|
| `REDIS_HOST` | Host |
| `REDIS_PORT` | Port (default `6379`) |
| `REDIS_PASSWORD` | Password (tùy chọn) |

Docker compose start redis với `--appendonly yes --appendfsync everysec` — pending ARQ jobs sống sót qua restart (~1s data loss tối đa).

### AI / LLM

**Admin configures qua UI** (trang AI Model Config) sau khi login lần đầu. **Không có env vars** cho AI key — design này tránh credential leak qua shell history / config files.

Sau lần deploy đầu, admin **bắt buộc** add 2 config:

| Purpose | Dùng cho | Bắt buộc? |
| ------- | -------- | --------- |
| `chat` (is_default=true) | Chat, agent skills, generator, review, VLM extraction | **Yes** — không có thì các tính năng AI fail với `AIModelConfigNotFoundError` |
| `embedding` (is_default=true) | RAG search, document chunk ingest | **Yes** — không có thì upload doc fail ở bước tạo embedding |

Embedding model **phải khớp `QDRANT_VECTOR_SIZE`** — text-embedding-3-large = 3072, text-embedding-3-small = 1536.

API endpoint admin dùng: `POST /api/v1/ai-model-configs` (xem Swagger).

### Vector Database (Qdrant)

| Biến | Mô tả | Mặc định |
|------|-------|----------|
| `QDRANT_URL` | URL server | `http://localhost:6333` |
| `QDRANT_COLLECTION` | Tên collection | `document_chunks` |
| `QDRANT_VECTOR_SIZE` | Số chiều vector — phải khớp với embedding model | `3072` |

### File Upload

| Biến | Mô tả | Mặc định |
|------|-------|----------|
| `GOTENBERG_URL` | Gotenberg URL. Local dev: `http://localhost:3000`. Compose override thành `http://gotenberg:3000` | `http://localhost:3000` |

Upload size limit (default 100MB) là **per-StorageConfig** — admin set qua trang Storage admin (Settings → Storage → edit/create config → field `max_upload_size_mb` trong JSONB `config`). Khác backend → khác limit (vd: S3 cho phép 500MB, local disk chỉ 100MB).

Extension allowlist hardcoded trong `src/core/file_validation.py:UPLOAD_ALLOWED_EXTENSIONS` (24 đuôi: pdf/doc/docx/xls/xlsx/ppt/pptx/txt/md/csv/...). File ngoài list bị reject ở API level.

`UPLOAD_DIR` cho LocalStorage backend cũng là per-config — đặt qua field `base_dir` trong storage config JSONB. Default `"uploads"`.

### Langfuse (LLM observability, optional)

| Biến | Mô tả |
|------|-------|
| `LANGFUSE_PUBLIC_KEY` | |
| `LANGFUSE_SECRET_KEY` | |
| `LANGFUSE_HOST` | URL Langfuse instance |

---

## Tích hợp SSO (Lumina SSO Service)

lumina-storage sử dụng **lumina-sso-service** làm cổng xác thực tập trung — đăng nhập qua Keycloak một lần, dùng được trên toàn Lumina platform. 

### Cài đặt

**Bước 1 — Khởi động SSO service:**
```bash
git clone <repo-url>
cd ../lumina-sso-service
cp sso-backend/.env.example sso-backend/.env
# Điền KC_CLIENT_SECRET và các biến Keycloak vào sso-backend/.env
docker compose up -d
bash setup.sh   # tạo realm, client, test users → in ra KC_CLIENT_SECRET
docker compose restart sso-backend
```
Chi tiết xem [`../lumina-sso-service/README.md`](../lumina-sso-service/README.md).

**Bước 2 — Thêm vào `.env` của lumina-storage-backend:**
```env
LUMINA_SSO_SERVICE_URL=http://localhost:3100
```

### Luồng đăng nhập

```
Frontend       →  GET  SSO_URL/auth/sso/login?redirect_uri={callback}&app=storage
Keycloak       →  xác thực user, redirect về SSO service
SSO service    →  redirect về {callback}?exchange_token=<token>
Frontend       →  POST SSO_URL/auth/sso/token  { exchange_token }
               ←  session_token + keycloak_id_token
Frontend       →  Authorization: Bearer <session_token>  →  lumina-storage-backend
lumina-storage-backend →  POST SSO_URL/auth/sso/validate  { session_token }
               ←  { valid, email, full_name, keycloak_sub }
lumina-storage-backend →  tra cứu user theo email trong DB, trả về response
```

> **Phân biệt token:** JWT có claim `keycloak_sub` → SSO token, validate qua SSO service. Không có → local JWT (email/password), xác thực bằng `SECRET_KEY`.

### Logout (SLO — Single Logout)

Frontend thực hiện tuần tự 3 bước:

```
1. GET  SSO_URL/auth/sso/logout-url?session_token=<token>&post_logout_redirect_uri=<app_url>
        ← end_session_url  (gọi trước khi revoke, khi Redis còn id_token)

2. POST SSO_URL/auth/sso/revoke  { session_token }
        ← xóa session khỏi Redis ngay lập tức

3. Redirect browser → end_session_url
        → Keycloak gọi back-channel logout → revoke session toàn platform
```

### Test accounts (local)

Được tạo tự động bởi `setup.sh` của lumina-sso-service:

| Email | Password | Vai trò |
|-------|----------|---------|
| `demo@lumina.local` | `Demo@123456` | User thông thường |
| `admin.sso@lumina.local` | `Admin@123456` | Admin |
| `manager.sso@lumina.local` | `Manager@123456` | Manager |
| `viewer.sso@lumina.local` | `Viewer@123456` | Viewer |

> Keycloak Admin Console: http://localhost:8080 — `admin` / `admin`

---

## Migrations

```bash
# Áp dụng tất cả migrations
uv run alembic upgrade head

# Xem revision hiện tại
uv run alembic current

# Xem lịch sử migration
uv run alembic history

# Tạo migration mới (auto-generate diff từ models)
uv run alembic revision --autogenerate -m "mô tả thay đổi"

# Rollback 1 bước (cẩn thận trên production!)
uv run alembic downgrade -1
```

Khi pull bản mới có thêm migration:

```bash
git pull
uv sync                     # update deps nếu pyproject thay đổi
uv run alembic upgrade head
# Restart app + worker
```

---

## Backup & Disaster Recovery

Xem chi tiết tại `docs/BACKUP_AND_PERSISTENCE.md`. Tóm tắt:

| Store | Backup strategy | RPO target |
| ----- | --------------- | ---------- |
| PostgreSQL | `pg_dump` daily + WAL archive cho PITR | 5 phút |
| Qdrant | Server-side snapshot weekly | 24 giờ |
| Redis (ARQ queue) | AOF persistence everysec | < 1 giây |
| Storage backend | Volume backup / S3 versioning | tùy backend |

Restore drill quarterly — backup chưa từng restore = chưa biết có dùng được không.

---

## Chạy Tests

```bash
# Toàn bộ tests
uv run pytest

# Verbose
uv run pytest -v

# Một file cụ thể
uv run pytest tests/test_documents.py

# Chỉ unit tests (không cần DB)
uv run pytest tests/test_text_chunking.py tests/test_file_validation.py \
              tests/test_dispatch_dedupe.py tests/test_agent_path_jail.py
```

Tests cần DB và Redis — cấu hình trong `.env` trước khi chạy. Xem `tests/conftest.py` cho fixture pattern.

---

## Troubleshooting

### `permission denied to create extension "unaccent"` khi alembic upgrade

App user không có quyền `CREATE EXTENSION`. DBA chạy 1 lần với superuser:
```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
```
Sau đó re-run `uv run alembic upgrade head` — migration có `IF NOT EXISTS` nên sẽ skip CREATE và chạy backfill.

### Search tiếng Việt không match khi gõ thiếu dấu

Verify migration `20260428a002` đã chạy:
```bash
uv run alembic current   # phải là 20260428a002 hoặc cao hơn
```
Verify extension đang có:
```sql
SELECT extname FROM pg_extension WHERE extname = 'unaccent';
```
Verify `search_vector` đã backfill:
```sql
SELECT count(*) FROM documents_documentcontent WHERE search_vector IS NOT NULL;
```

### Upload file `.pdf` bị reject với "extension not allowed"

Kiểm tra `src/core/file_validation.py:UPLOAD_ALLOWED_EXTENSIONS`. Hoặc file có MIME thật không khớp đuôi (vd: `.exe` đổi tên thành `.pdf` → libmagic catch). Trên dev không có libmagic thì validate skip — kiểm tra log `validate_file_content`.

### Worker không xử lý jobs / "Pending" mãi

```bash
# Verify worker container/process đang chạy
docker compose ps worker

# Xem logs
docker compose logs -f worker

# Verify Redis kết nối được
docker compose exec worker python -c "import redis; redis.Redis(host='redis').ping()"
```

Nếu worker container chết liên tục, healthcheck fail → check Redis có lên trước không.

### Gọi `/auth/register` trả `401 Unauthorized`

Đúng — endpoint này hardcode admin-only. Frontend phải gửi access token của admin trong header `Authorization: Bearer <token>` khi tạo user mới. Không có cách nào để bật public self-registration (cố ý).

### Login admin với `Admin@123` → 401

Migration đã chạy chưa? Có ai đổi pass admin chưa? Login bằng pass mới đó. Nếu quên pass admin, reset thủ công:
```sql
-- Set lại Admin@123 (chỉ làm khi cần)
UPDATE users_user
SET password = '$2b$12$<bcrypt_hash_của_Admin@123>',
    force_change_password = true
WHERE username = 'admin';
```
Hash bcrypt sinh bằng:
```bash
uv run python -c "import bcrypt; print(bcrypt.hashpw(b'Admin@123', bcrypt.gensalt()).decode())"
```

### `RuntimeError: libmagic is not installed in this environment but app_env=production`

Thiếu `libmagic1` trong runtime environment. Trong Docker đã include, nếu deploy bare-metal:
```bash
# Debian/Ubuntu
sudo apt-get install -y libmagic1

# RHEL/CentOS
sudo yum install -y file-libs
```

### `AIModelConfigNotFoundError: No default AI model configured for purpose='chat'`

Chưa add AI Model Config sau khi deploy. Xem [Bước 6.2](#62-add-ai-model-config-bắt-buộc-không-có-fallback) — admin phải `POST /api/v1/ai-model-configs` với `purpose='chat'` (cho chat/generator/review/VLM) và `purpose='embedding'` (cho RAG/ingest), cả 2 đều `is_default=true`.

### `BadRequestError: No default storage config. Ask admin to configure one.`

Chưa add Storage Config. Xem [Bước 6.3](#63-add-storage-config-bắt-buộc-không-có-default) — admin phải `POST /api/v1/storage/configs` với `is_default=true`.

### Upload xong nhưng worker không ingest (status="pending" mãi)

Xem [Worker không xử lý jobs](#worker-không-xử-lý-jobs--pending-mãi) ở trên. Hoặc embedding model chưa add → check log worker, sẽ thấy `AIModelConfigNotFoundError: ... purpose='embedding'`.

---

## Cấu trúc thư mục

```
lumina-driver-backend/
├── main.py                 # FastAPI app factory + lifespan
├── pyproject.toml          # Project config + dependencies
├── alembic/                # Database migrations
│   └── versions/
├── docs/                   # BACKUP_AND_PERSISTENCE.md, REMEDIATION_REPORT_*.md, ...
├── src/
│   ├── api/v1/routes/      # API endpoints
│   ├── core/               # config, database, security, file_validation
│   ├── models/             # SQLAlchemy ORM models
│   ├── repositories/       # Data access layer
│   ├── schemas/            # Pydantic request/response schemas
│   ├── services/           # Business logic (agent, chat, document, ...)
│   └── worker/             # ARQ background workers + cron jobs
├── skills/                 # Pluggable skill packages (each has SKILL.md + tools/*.py)
├── tests/                  # pytest suite
├── scripts/                # One-shot utilities
├── docker-compose.yml      # redis + gotenberg + app + worker + migrate
├── Dockerfile              # 2-stage build, non-root appuser, libmagic + libpq
└── .env.example            # Template biến môi trường
```

---

## Khi cần hỗ trợ

- Vấn đề security: xem `docs/REMEDIATION_REPORT_2026-04-28.md` cho lịch sử fix
- Architecture overview: `AGENT_ARCHITECTURE.md` (luồng agent + skill)
- Skill flow: `SKILL_FLOW.md`
