"""Pre/post-deploy sanity check.

Usage:
    uv run python scripts/check_deploy.py

Walks through the things that go wrong on first deploy and reports each one
as PASS / WARN / FAIL with a fix hint. Exit code = number of FAIL items so
you can wire it into CI / a `make verify` target.
"""

from __future__ import annotations

import asyncio
import sys


# ── Output helpers ────────────────────────────────────────────────────────

PASS = "PASS"
WARN = "WARN"
FAIL = "FAIL"

_failures: list[str] = []
_warnings: list[str] = []


def report(label: str, status: str, detail: str = "", *, fix: str = "") -> None:
    print(f"  [{status}] {label}{(' -- ' + detail) if detail else ''}")
    if fix and status != PASS:
        print(f"         fix: {fix}")
    if status == FAIL:
        _failures.append(label)
    elif status == WARN:
        _warnings.append(label)


# ── Checks ────────────────────────────────────────────────────────────────


def check_env_vars() -> None:
    print("\n== Environment variables")
    try:
        from src.core.config import get_settings
    except Exception as exc:
        report("settings load", FAIL, str(exc),
               fix="check .env exists and is well-formed")
        return

    settings = get_settings()

    # Hard-required to start the app. AI keys are NOT here — admin configures
    # them via the AI Model Config UI at runtime, not at deploy time.
    required = {
        "SECRET_KEY": settings.secret_key,
        "DB_HOST": settings.db_host,
        "DB_NAME": settings.db_name,
        "DB_USER": settings.db_user,
        "DB_PASSWORD": settings.db_password,
        "REDIS_HOST": settings.redis_host,
        "QDRANT_URL": settings.qdrant_url,
    }
    for name, val in required.items():
        if not val:
            report(f"{name} set", FAIL, "empty", fix=f"set {name} in .env")
        else:
            report(f"{name} set", PASS)

    if settings.secret_key in ("changeme", "your-secret-key-here", "lumina-secret-key-change-in-production"):
        report("SECRET_KEY is not a placeholder", FAIL, repr(settings.secret_key),
               fix='python -c "import secrets; print(secrets.token_urlsafe(32))"')
    elif len(settings.secret_key) < 32:
        report("SECRET_KEY is at least 32 chars", WARN, f"got {len(settings.secret_key)}",
               fix="regenerate with secrets.token_urlsafe(32)")
    else:
        report("SECRET_KEY is strong", PASS)

    if settings.app_env == "production":
        cors_str = ",".join(settings.cors_origins)
        if "*" in cors_str or "localhost" in cors_str:
            report("CORS_ORIGINS is production-strict", WARN, cors_str,
                   fix="remove localhost / wildcard from CORS_ORIGINS in production")
        else:
            report("CORS_ORIGINS is production-strict", PASS)


async def check_ai_model_config() -> None:
    print("\n== AI Model Config (admin-configured at runtime)")
    try:
        from sqlalchemy import text
        from src.core.database import AsyncSessionLocal
    except Exception:
        return

    try:
        async with AsyncSessionLocal() as db:
            r = await db.execute(text(
                "SELECT count(*) FROM core_aimodelconfig WHERE is_active = true"))
            count = r.scalar() or 0
        if count == 0:
            report("active AI model config", WARN, "none configured",
                   fix="login as admin -> AI Model Config -> add at least one active model "
                       "(chat + embedding) before users can use chat / RAG")
        else:
            report("active AI model config", PASS, f"{count} active")
    except Exception as exc:
        # Table might not exist yet on a really fresh DB before migrations
        report("active AI model config", WARN, f"could not query: {exc}",
               fix="ensure migrations have run; admin must add models via UI")


async def check_postgres() -> None:
    print("\n== PostgreSQL")
    try:
        from sqlalchemy import text
        from src.core.database import AsyncSessionLocal
    except Exception as exc:
        report("DB module imports", FAIL, str(exc))
        return

    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        report("DB connection", PASS)
    except Exception as exc:
        report("DB connection", FAIL, str(exc),
               fix="check DB_HOST/DB_PORT/DB_USER/DB_PASSWORD reachability")
        return

    try:
        async with AsyncSessionLocal() as db:
            r = await db.execute(text(
                "SELECT extname FROM pg_extension WHERE extname = 'unaccent'"))
            exts = [row[0] for row in r]
        if exts:
            report("unaccent extension installed", PASS)
        else:
            report("unaccent extension installed", FAIL,
                   "missing — Vietnamese FTS will fail",
                   fix="DBA: CREATE EXTENSION IF NOT EXISTS unaccent;")
    except Exception as exc:
        report("unaccent extension installed", FAIL, str(exc))

    try:
        async with AsyncSessionLocal() as db:
            r = await db.execute(text("SELECT version_num FROM alembic_version"))
            row = r.first()
            current = row[0] if row else None
        expected = "20260428a002"
        if current == expected:
            report(f"alembic at head ({expected})", PASS)
        elif current is None:
            report("alembic at head", FAIL, "no version row",
                   fix="uv run alembic upgrade head")
        else:
            report(f"alembic at head ({expected})", WARN,
                   f"got {current}",
                   fix="uv run alembic upgrade head")
    except Exception as exc:
        report("alembic version table", FAIL, str(exc),
               fix="uv run alembic upgrade head")


async def check_admin() -> None:
    print("\n== Admin user")
    try:
        from sqlalchemy import text
        from src.core.database import AsyncSessionLocal
    except Exception:
        return

    admin_id = "00000000-0000-0000-0000-000000000002"
    try:
        async with AsyncSessionLocal() as db:
            r = await db.execute(text(
                "SELECT username, email, force_change_password, last_login IS NULL AS never "
                "FROM users_user WHERE id = :id"), {"id": admin_id})
            row = r.first()
        if row is None:
            report("admin user seeded", FAIL,
                   fix="uv run alembic upgrade head (re-runs seed migration)")
            return
        report("admin user seeded", PASS, f"{row[0]} <{row[1]}>")
        if row[3]:  # never logged in
            report("admin login state",
                   WARN if row[2] else FAIL,
                   "never logged in" + (" (force_change_password set)" if row[2] else ""),
                   fix="login as admin/Admin@123 and complete /auth/change-password")
        else:
            if row[2]:
                report("admin password rotated", WARN,
                       "force_change_password is True but admin has logged in — "
                       "they may be stuck in the change-password loop",
                       fix="UPDATE users_user SET force_change_password=false WHERE id='"
                           + admin_id + "' AND last_login IS NOT NULL;")
            else:
                report("admin password rotated", PASS)
    except Exception as exc:
        report("admin user seeded", FAIL, str(exc))


async def check_redis() -> None:
    print("\n== Redis")
    try:
        import redis.asyncio as redis_async
        from src.core.config import get_settings
    except Exception as exc:
        report("redis module imports", FAIL, str(exc))
        return

    settings = get_settings()
    try:
        client = redis_async.from_url(settings.redis_url)
        pong = await client.ping()
        await client.aclose()
        report("Redis ping", PASS if pong else FAIL)
    except Exception as exc:
        report("Redis ping", FAIL, str(exc),
               fix="check REDIS_HOST/REDIS_PORT and that redis is up")


async def check_qdrant() -> None:
    print("\n== Qdrant")
    try:
        from qdrant_client import AsyncQdrantClient
        from src.core.config import get_settings
    except Exception as exc:
        report("qdrant module imports", FAIL, str(exc))
        return

    settings = get_settings()
    try:
        client = AsyncQdrantClient(url=settings.qdrant_url)
        info = await client.get_collections()
        names = [c.name for c in info.collections]
        await client.close()
        report("Qdrant connection", PASS,
               f"{len(names)} collection(s)")
        if settings.qdrant_collection in names:
            report(f"collection '{settings.qdrant_collection}' exists", PASS)
        else:
            report(f"collection '{settings.qdrant_collection}' exists", WARN,
                   "will be created on first ingest",
                   fix="upload a test document to trigger collection creation")
    except Exception as exc:
        report("Qdrant connection", FAIL, str(exc),
               fix="check QDRANT_URL")


def check_libmagic() -> None:
    print("\n== libmagic (file content validation)")
    import sys as _sys
    if _sys.platform == "win32":
        report("libmagic", WARN, "skipped on Windows — fail-open in dev",
               fix="not needed for dev; production runs in Linux Docker with libmagic1")
        return
    try:
        import magic  # noqa: F401
        report("libmagic loadable", PASS)
    except (ImportError, OSError) as exc:
        app_env = os.environ.get("APP_ENV", "development")
        sev = FAIL if app_env == "production" else WARN
        report("libmagic loadable", sev, str(exc),
               fix="apt-get install libmagic1 (Debian/Ubuntu) — Dockerfile already does this")


# ── Driver ────────────────────────────────────────────────────────────────


async def main() -> int:
    print("Lumina Storage — deploy sanity check")
    print("=" * 60)

    check_env_vars()
    await check_postgres()
    await check_admin()
    await check_ai_model_config()
    await check_redis()
    await check_qdrant()
    check_libmagic()

    print("\n" + "=" * 60)
    print(f"Summary: {len(_failures)} fail, {len(_warnings)} warn")
    if _failures:
        print("\nFAIL items must be fixed before serving traffic:")
        for f in _failures:
            print(f"  - {f}")
    return len(_failures)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
