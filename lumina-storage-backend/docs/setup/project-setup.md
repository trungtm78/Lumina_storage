# Project Setup — lumina-driver-backend

## Stack

| Thành phần | Công nghệ | Lý do chọn |
|---|---|---|
| Framework | FastAPI | Async-native, tự sinh OpenAPI docs, type-safe với Pydantic |
| Database | PostgreSQL 14+ | UUID, JSONB, TSVECTOR, INET, partial unique index |
| ORM | SQLAlchemy 2.x async | Type-safe mapped_column, async session |
| Migration | Alembic | Autogenerate từ models, hỗ trợ async engine |
| Auth | JWT access + refresh (HS256) | Stateless, phù hợp driver/mobile app |
| Background tasks | ARQ + Redis | Async-native worker, dùng chung AsyncSession với FastAPI |
| Dep manager | uv | Nhanh hơn pip/poetry, lock file chuẩn |
| RAG / Chunking | LangChain text-splitters | MarkdownHeaderTextSplitter + RecursiveCharacterTextSplitter |
| Vector DB | Qdrant | ANN search cho semantic retrieval |
| Embedding | Azure text-embedding-3-large (via LiteLLM) | 3072d, high quality multilingual |
| LLM | Azure / OpenAI / Anthropic / Google / Ollama (via LiteLLM) | Pluggable provider |
| OCR | Google Cloud Vision API | Scanned PDF + image OCR, chỉ cần credentials JSON |
| Office → text | markitdown | DOCX/XLSX/PPTX → Markdown, đơn giản, không cần LibreOffice |
| PDF render | PyMuPDF | Native text extract + render page image |
| Office → PDF (thumbnail) | Gotenberg | DOCX/XLSX/PPTX → PDF để render thumbnail |

## Cấu trúc thư mục

```
lumina-driver-backend/
├── src/
│   ├── api/
│   │   ├── deps.py             # FastAPI dependencies (get_current_user, ...)
│   │   └── v1/routes/          # Endpoint handlers theo feature
│   ├── core/
│   │   ├── config.py           # Settings từ .env (pydantic-settings)
│   │   ├── database.py         # Engine + AsyncSession + get_db()
│   │   ├── security.py         # JWT encode/decode, bcrypt hash
│   │   └── exceptions.py       # AppException hierarchy + handlers
│   ├── models/                 # SQLAlchemy ORM models (24 tables)
│   ├── schemas/                # Pydantic request/response schemas
│   ├── repositories/           # Data access layer — chỉ CRUD, không logic
│   ├── services/               # Business logic — gọi repo, không gọi DB trực tiếp
│   └── worker/                 # ARQ worker: settings, context, tasks, dispatch helper
├── alembic/                    # Migrations
│   └── versions/
├── docs/
│   ├── setup/                  # Hướng dẫn cài đặt và vận hành
│   ├── schema/                 # Database schema SQL gốc
│   └── api/                    # Tài liệu từng nhóm API
├── tests/
├── main.py                     # App entry point (create_app)
├── pyproject.toml
└── alembic.ini
```

### Tại sao tách Repository và Service?

- **Repository**: chỉ nói chuyện với DB (SELECT, INSERT, UPDATE, DELETE). Không chứa business logic.
- **Service**: chứa business logic, gọi repository. Không import `AsyncSession` trực tiếp để query.
- Dễ test từng layer độc lập, dễ mock repo trong unit test service.

## Yêu cầu

- Python >= 3.11
- [uv](https://docs.astral.sh/uv/) đã cài global
- PostgreSQL 14+ đang chạy

## Cài đặt lần đầu

```bash
# Clone repo
git clone <repo-url>
cd lumina-driver-backend

# Cài dependencies
uv sync

# Copy và sửa file env
cp .env.example .env
```

Sửa `.env`:

```env
DATABASE_URL=postgresql+asyncpg://<user>:<password>@localhost:5432/lumina_driver_dev
SECRET_KEY=<random-string-ít-nhất-32-ký-tự>
APP_ENV=development
```

## Khởi tạo database

```bash
# Tạo DB
createdb lumina_driver_dev

# Chạy toàn bộ migration
uv run alembic upgrade head
```

## Chạy server

```bash
uv run uvicorn main:app --reload
```

## Chạy ARQ worker

```bash
# Terminal riêng — worker cần Redis đang chạy
uv run arq src.worker.settings.WorkerSettings
```

| URL | Mô tả |
|-----|-------|
| `http://localhost:8000/docs` | Swagger UI |
| `http://localhost:8000/redoc` | ReDoc |
| `http://localhost:8000/api/v1/health` | Health check |

## Biến môi trường

| Biến | Mô tả | Default |
|---|---|---|
| `APP_ENV` | `development` / `production` | `development` |
| `SECRET_KEY` | Key ký JWT (HS256) | `changeme` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Thời hạn access token | `30` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Thời hạn refresh token | `7` |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | Tên database | — |
| `DB_USER` | PostgreSQL user | — |
| `DB_PASSWORD` | PostgreSQL password | — |
| `REDIS_HOST` | Redis hostname | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis password (để trống nếu không có) | `""` |
| `AI_LLM_MODEL` | LiteLLM model string, e.g. `azure/gpt-4.1-mini` | — |
| `AI_LLM_API_KEY` | API key cho LLM provider | — |
| `AI_LLM_API_BASE` | Base URL cho LLM provider (Azure endpoint) | — |
| `AI_LLM_API_VERSION` | API version (Azure) | — |
| `AI_EMBEDDING_MODEL` | LiteLLM embedding model, e.g. `azure/text-embedding-3-large` | — |
| `QDRANT_URL` | Qdrant server URL | — |
| `QDRANT_COLLECTION` | Tên collection trong Qdrant | — |
| `QDRANT_VECTOR_SIZE` | Kích thước vector (phải khớp với embedding model) | `3072` |
| `GOTENBERG_URL` | Gotenberg service URL (convert Office → PDF cho thumbnail) | `http://localhost:3000` |

## Làm việc với Alembic

```bash
# Tạo migration sau khi thay đổi model
uv run alembic revision --autogenerate -m "mô tả ngắn"

# Áp migration mới nhất lên DB
uv run alembic upgrade head

# Rollback 1 bước
uv run alembic downgrade -1

# Xem lịch sử
uv run alembic history --verbose
```

> **Lưu ý:** Alembic không tự sinh triggers (FTS tsvector, updated_at). Cần `op.execute()` thủ công trong migration nếu cần triggers.

## Chạy tests

```bash
uv run pytest
```
