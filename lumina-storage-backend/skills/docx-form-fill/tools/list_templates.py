"""List all available docx templates for the current user.

Returns template_id, source_document_id, description, and field list.
Agent uses this to show user which templates exist and what fields need filling.

Agent calls:
    run_script("skills/docx-form-fill/tools/list_templates.py", '{}')
"""

from __future__ import annotations


async def run(args: dict, ctx) -> dict:
    """List all docx templates owned by current user."""
    from sqlalchemy import text as sa_text

    result = await ctx.db.execute(
        sa_text(
            "SELECT id, title, description, original_filename, source_metadata "
            "FROM documents_document "
            "WHERE owner_id = :uid AND source_type = 'template' AND deleted_at IS NULL "
            "AND extension IN ('docx', '.docx', 'doc', '.doc') "
            "ORDER BY updated_at DESC LIMIT 20"
        ),
        {"uid": ctx.user.id},
    )
    rows = result.fetchall()

    if not rows:
        return {"templates": [], "message": "Chưa có template nào."}

    templates = []
    for r in rows:
        meta = r[4] or {}
        fields = meta.get("template_fields", [])
        templates.append({
            "template_id": str(r[0]),
            "source_document_id": meta.get("source_document_id", ""),
            "title": r[1],
            "description": r[2] or "",
            "file": r[3],
            "field_count": len(fields),
            "fields": [f["placeholder"] for f in fields],
        })

    return {"templates": templates}
