"""Shim (P8 W3): legal_catalog_parser → src/domain/generator/legal_catalog_parser.py (scripts import)."""
from src.domain.generator.legal_catalog_parser import (  # noqa: F401
    CatalogEntry,
    categories_in_order,
    parse_legal_catalog,
)

__all__ = ["CatalogEntry", "categories_in_order", "parse_legal_catalog"]
