# Lumina Storage — Local Development Onboarding

Welcome. This bundle is everything you need to run the **Lumina Storage** stack
locally: backend (FastAPI) + frontend (React/Vite) + infra (postgres, redis,
qdrant, gotenberg).

It is **self-contained** — no other lumina repos required. SSO is **disabled**
by default; you sign in with a local admin account (see step 5).

---

## 1. What is Lumina Storage?

Lumina Storage is a document management + RAG + chat system. Architecture:

```
Browser (FE :5174)
   ↓ HTTP/REST
Storage Backend (FastAPI :1690)
   ↓
   ├─→ PostgreSQL   (metadata, users, permissions)
   ├─→ Redis        (cache + ARQ job queue)
   ├─→ Qdrant       (vector embeddings for RAG)
   └─→ Gotenberg    (office → PDF conversion)
   ↑
Storage Worker (arq, background jobs)
```

The frontend is React 18 + Vite, the backend is FastAPI 3.13 + SQLAlchemy 2.

## 2. Prerequisites

Install these once on your machine:

| Tool | Version | Why |
|------|---------|-----|
| Docker | 24+ | runs infra + backend containers |
| Docker Compose v2 | bundled with Docker | orchestrates the stack |
| Node.js | 22+ (LTS) | runs the Vite frontend |
| npm | bundled with Node | installs frontend deps |

You do **not** need to install Python, PostgreSQL, Redis, or Qdrant locally —
everything runs inside Docker. Optional: `uv` if you want to run the backend
outside Docker for fast iteration.

> **Note on file permissions:** the backend container runs as uid/gid
> `1000:1000` by default so it can write to `./lumina-storage-backend/uploads`.
> On macOS (host uid usually `501`) or a non-default Linux user, set
> `LOCAL_UID` and `LOCAL_GID` in `.env` to match your host user:
> ```bash
> echo "LOCAL_UID=$(id -u)" >> .env
> echo "LOCAL_GID=$(id -g)" >> .env
> ```

> **Don't run alongside the 4-repo `lumina-bundle.zip`:** both bundles bind
> the same host ports (5433, 6380, 6333, 3000, 1690). Stop one before
> starting the other.

## 3. Get the code

```bash
unzip lumina-storage-bundle.zip
cd lumina-storage-bundle
```

You should see:

```
lumina-storage-bundle/
├── README.md                       ← this file
├── docker-compose.yml              ← infra + backend
├── .env.example                    ← copy to .env
├── docker/postgres-init/           ← DB init scripts
├── lumina-storage-backend/         ← FastAPI service
└── lumina-storage-frontend/        ← React app
```

## 4. Configure environment

Two `.env` files to create:

### 4a. Backend env (bundle root)

```bash
cp .env.example .env
```

Generate a `SECRET_KEY` and paste it into `.env`:

```bash
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
# or: openssl rand -base64 32
```

Open `.env` and replace `SECRET_KEY=your-secret-key-here` with the generated
value. Everything else can stay at defaults.

### 4b. Frontend env (subdir)

```bash
cd lumina-storage-frontend
cp .env.example .env.development.local
```

Open `.env.development.local` and set:

```dotenv
VITE_API_PREFIX=http://localhost:1690/api/v1
VITE_SSO_SERVICE_URL=
VITE_SSO_AUTO_REDIRECT=false
VITE_ENTRA_STORAGE_FE_CLIENT_ID=
VITE_ENTRA_REDIRECT_URI=http://localhost:5174/auth/microsoft/popup
VITE_CORE_ORIGIN=http://localhost:5174
```

SSO and Microsoft Entra are **disabled** (empty values) — the app will use
local JWT for sign-in.

Go back to the bundle root:

```bash
cd ..
```

## 5. Start the backend + infra

```bash
docker compose up -d --build
```

This starts 7 containers:

| Service | Purpose | First-boot time |
|---------|---------|------------------|
| `postgres` | metadata DB on host port **5433** | a few seconds |
| `redis` | job queue on host port **6380** | < 1 second |
| `qdrant` | vector DB on host ports **6333**+**6334** | ~5–15 seconds |
| `gotenberg` | doc → PDF on host port **3000** | ~30 seconds (LibreOffice init) |
| `migrate` | runs `alembic upgrade head`, exits 0 | ~10–30 seconds (after postgres healthy) |
| `app` | FastAPI on host port **1690** | ~30–60 seconds (first build) |
| `worker` | arq worker (no host port) | ~30–60 seconds (first build) |

Check progress:

```bash
docker compose ps                  # service health
docker compose logs -f migrate     # watch migrations
docker compose logs -f app         # watch backend
```

Wait until `app` shows `healthy` and `migrate` shows `exited (0)`.

Verify the backend is alive:

```bash
curl http://localhost:1690/api/v1/health
# → {"status":"ok","version":"1.0.0"}
```

Swagger UI: <http://localhost:1690/docs>

## 6. Start the frontend

In a new terminal:

```bash
cd lumina-storage-frontend
npm install
npm run dev
```

Vite will listen on <http://localhost:5174> (port is `strictPort` — change
`vite.config.ts` if 5174 conflicts). Open it in your browser.

## 7. Sign in with the local admin

The first time you boot the stack, the alembic migration `20260407_seed_admin_user.py`
seeds a default admin account:

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `Admin@123` |
| Email | `admin@lumina.com` |

Sign in at <http://localhost:5174>. The backend returns `must_change_password=true`
on the first login response, so the UI will prompt you to set a new password.
After that, `Admin@123` no longer works.

> **Note:** `/auth/register` is admin-only — there is no public sign-up. Create
> additional users from the **Users** admin page once you're logged in as admin.

## 8. Configure AI models (required for chat / RAG)

Chat, RAG, generator, and review features call external LLM / embedding
providers. Credentials are **not** in env vars — they're stored in the database
and managed through the **AI Model Config** UI.

1. Sign in as `admin`.
2. Navigate to **AI Model Config** (admin menu).
3. Add at least one **default chat model** (e.g. `gpt-4o`, `claude-3-5-sonnet`,
   or any LiteLLM-supported provider).
4. Add at least one **default embedding model** (e.g. `text-embedding-3-large`,
   vector size 3072 — matches `QDRANT_VECTOR_SIZE=3072` in `.env`).

If you skip this, chat/RAG endpoints return a clear error:
> No default AI model configured

## 9. Smoke test

End-to-end sanity check:

- [ ] `curl http://localhost:1690/api/v1/health` → `200 {"status":"ok",...}`
- [ ] Frontend loads at <http://localhost:5174> without console errors.
- [ ] DevTools Network shows FE calling `localhost:1690/api/v1/...` without
      CORS errors.
- [ ] Login with `admin` / `Admin@123` works, password change prompt appears.
- [ ] Upload a small PDF or DOCX at the FE — should appear in the document
      list. Check `docker compose logs -f worker` to see the ingest job run.
- [ ] Open a document and ask a question in the chat panel — should return an
      answer using RAG.

## 10. Troubleshooting

### "Port X is already in use"

Edit `.env` at the bundle root and change the relevant `*_PORT` value, then
restart: `docker compose down && docker compose up -d`.

| Service | Default host port | Env var |
|---------|-------------------|---------|
| postgres | 5433 | `POSTGRES_PORT` |
| redis | 6380 | `REDIS_PORT` |
| qdrant | 6333 | `QDRANT_PORT` |
| gotenberg | 3000 | `GOTENBERG_PORT` |
| backend | 1690 | `STORAGE_PORT` |

Update the FE's `VITE_API_PREFIX` accordingly.

### "alembic migration failed"

```bash
docker compose logs migrate
```

Most common cause: postgres volume from a previous run had data but no
`unaccent` extension. Fix:

```bash
docker compose down -v           # WARNING: drops all DB data
docker compose up -d             # re-init with fresh volume
```

### Qdrant healthcheck keeps failing

Qdrant takes ~10–20 seconds to boot on a cold volume. The compose healthcheck
allows a `start_period: 20s` for this. If it still fails:

```bash
docker compose logs qdrant
curl -f http://localhost:6333/healthz
```

### "libmagic" errors on upload

Already installed in the Docker image. If you run the backend outside Docker,
install it on your host: `apt-get install libmagic1` (Debian/Ubuntu) or
`brew install libmagic` (macOS).

### Frontend shows "Network Error" / CORS

Check `.env` at the bundle root has:

```dotenv
CORS_ORIGINS=["http://localhost:5174"]
```

Restart `app` after changing: `docker compose restart app`.

### Reset everything

```bash
docker compose down -v            # drop containers + volumes
cd lumina-storage-frontend && rm -rf node_modules && cd ..
# repeat from step 4
```

## 11. Optional — enabling SSO

By default, the backend signs and verifies JWTs locally with `SECRET_KEY`
(HS256). To switch to centralized auth via `lumina-sso-service`:

1. Start `lumina-sso-service` separately (outside this bundle).
2. Edit `.env`:
   ```dotenv
   LUMINA_SSO_SERVICE_URL=http://localhost:3100
   ```
3. Edit `lumina-storage-frontend/.env.development.local`:
   ```dotenv
   VITE_SSO_SERVICE_URL=http://localhost:3100
   VITE_SSO_AUTO_REDIRECT=true
   ```
4. `docker compose restart app worker`

Configuring SSO users / Keycloak realms is out of scope for this bundle.

---

## Service URLs cheat sheet

| What | URL |
|------|-----|
| Frontend (dev server) | <http://localhost:5174> |
| Backend API | <http://localhost:1690/api/v1> |
| Swagger UI | <http://localhost:1690/docs> |
| Health check | <http://localhost:1690/api/v1/health> |
| Qdrant dashboard | <http://localhost:6333/dashboard> |
| Postgres | `localhost:5433` (user `lumina`, pass `lumina123`, db `lumina_driver_dev`) |
| Redis | `localhost:6380` |

## File map

```
lumina-storage-bundle/
├── README.md                       ← you are here
├── docker-compose.yml              ← infra + backend stack
├── .env.example                    ← template (copy to .env)
├── docker/
│   └── postgres-init/
│       └── 01-init-db.sh           ← creates DB + unaccent extension
├── lumina-storage-backend/         ← FastAPI service (tracked source)
│   ├── main.py
│   ├── Dockerfile
│   ├── alembic/                    ← migrations + admin seed
│   ├── src/                        ← application code
│   └── ...
└── lumina-storage-frontend/        ← React app (tracked source)
    ├── src/
    ├── package.json
    └── ...
```

## Where to go next

- Backend API docs: <http://localhost:1690/docs>
- Frontend code: `lumina-storage-frontend/src/`
- Backend code: `lumina-storage-backend/src/`
- Database migrations: `lumina-storage-backend/alembic/versions/`

Happy hacking.