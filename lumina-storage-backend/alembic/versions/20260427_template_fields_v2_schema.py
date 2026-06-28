"""template_fields v2 schema — backfill options/section_key/required + language_mode/sections

Revision ID: 20260427a001
Revises: ea2a6a6ad1d9
Create Date: 2026-04-27

Phase 1 schema upgrade for Document Generator. Templates store fields inside
`documents_document.source_metadata` JSONB — no DDL change needed. This data
migration backfills new keys with safe defaults so downstream code never sees
None values mixed with explicit booleans/lists.

Per-field backfill:
  - options:     None
  - section_key: None
  - required:    legacy rule (type != "blank")

Per-template backfill:
  - language_mode: "single"
  - sections:      []

Pydantic on the read path already tolerates missing keys, so the migration is
idempotent and safe to re-run.
"""
from __future__ import annotations

import json
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "20260427a001"
down_revision: Union[str, None] = "ea2a6a6ad1d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _backfill_field(field: dict) -> dict:
    field.setdefault("options", None)
    field.setdefault("section_key", None)
    if "required" not in field:
        field["required"] = field.get("type") != "blank"
    return field


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        text(
            "SELECT id, source_metadata FROM documents_document "
            "WHERE source_type = 'template' AND deleted_at IS NULL"
        )
    ).fetchall()

    for row in rows:
        meta = dict(row.source_metadata or {})
        fields = list(meta.get("template_fields") or [])
        meta["template_fields"] = [_backfill_field(dict(f)) for f in fields]
        meta.setdefault("language_mode", "single")
        meta.setdefault("sections", [])
        conn.execute(
            text(
                "UPDATE documents_document SET source_metadata = :meta "
                "WHERE id = :id"
            ),
            {"meta": json.dumps(meta), "id": row.id},
        )


def downgrade() -> None:
    """Strip the v2 keys to restore the v1 shape (best-effort)."""
    conn = op.get_bind()
    rows = conn.execute(
        text(
            "SELECT id, source_metadata FROM documents_document "
            "WHERE source_type = 'template' AND deleted_at IS NULL"
        )
    ).fetchall()

    for row in rows:
        meta = dict(row.source_metadata or {})
        meta.pop("language_mode", None)
        meta.pop("sections", None)
        stripped_fields = []
        for f in meta.get("template_fields") or []:
            f = dict(f)
            f.pop("options", None)
            f.pop("section_key", None)
            f.pop("required", None)
            stripped_fields.append(f)
        meta["template_fields"] = stripped_fields
        conn.execute(
            text(
                "UPDATE documents_document SET source_metadata = :meta "
                "WHERE id = :id"
            ),
            {"meta": json.dumps(meta), "id": row.id},
        )
