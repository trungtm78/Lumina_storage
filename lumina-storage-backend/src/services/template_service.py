"""Shim (P8 W3): template_service → src/domain/generator/template_service.py (worker import)."""
from src.domain.generator.template_service import commit_template, extract_template, extract_template_draft  # noqa: F401

__all__ = ["commit_template", "extract_template", "extract_template_draft"]
