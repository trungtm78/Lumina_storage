# ── Stage 1: build dependencies ────────────────────────────────────────────
FROM python:3.13-slim AS builder

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Copy dependency files first (layer cache)
COPY pyproject.toml uv.lock ./

# Install production dependencies into /app/.venv
RUN uv sync --frozen --no-dev --no-install-project

# ── Stage 2: runtime image ──────────────────────────────────────────────────
FROM python:3.13-slim AS runtime

# System dependencies. libmagic1 is required by python-magic for upload content sniffing —
# without it file_validation silently disables itself and every upload bypasses the check.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    ca-certificates \
    curl \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser

WORKDIR /app

# Copy the virtualenv from builder
COPY --from=builder --chown=appuser:appuser /app/.venv /app/.venv

# Copy application source
COPY --chown=appuser:appuser . .

# uploads directory must be writable by appuser (volume mount preserves perms)
RUN mkdir -p /app/uploads && chown appuser:appuser /app/uploads

# Make sure the venv is on PATH
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER appuser

EXPOSE 1688

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:1688/api/v1/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "1688", "--workers", "4"]

# ── Stage 3: test image (dev deps + source, chạy pytest) ────────────────────
# Tách riêng để không phình runtime. Cài libmagic1 vì python-magic cần nó khi
# test storage/upload; uv sync (bỏ --no-dev) để có pytest/respx/fakeredis.
FROM builder AS test

RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN uv sync --frozen
COPY . .
ENV PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"
CMD ["uv", "run", "pytest", "-q"]
