"""Shim (P8 W3): thumbnail → src/domain/document/thumbnail.py (worker)."""
from src.domain.document.thumbnail import generate_thumbnail, save_thumbnail  # noqa: F401

__all__ = ["generate_thumbnail", "save_thumbnail"]
