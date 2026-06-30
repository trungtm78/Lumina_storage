"""Shim (P8 W3): auth route → src/domain/identity/auth_routes.py. Re-export router + limiter (main.py app.state.limiter=auth.limiter)."""
from src.domain.identity.auth_routes import router, limiter  # noqa: F401

__all__ = ["router", "limiter"]
