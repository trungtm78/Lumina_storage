"""Shim (P8 W3): generator route → src/domain/generator/routes.py. Re-export router + _consume_stream_with_disconnect (test import)."""
from src.domain.generator.routes import router, _consume_stream_with_disconnect  # noqa: F401

__all__ = ["router", "_consume_stream_with_disconnect"]
