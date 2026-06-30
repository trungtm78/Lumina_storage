"""Shim (P8 W3): review route → src/domain/review/routes.py. Re-export router cho main.py."""
from src.domain.review.routes import router

__all__ = ["router"]
