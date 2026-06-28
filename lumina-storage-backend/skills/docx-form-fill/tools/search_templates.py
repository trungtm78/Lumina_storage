"""Search for extracted templates matching a query.

Returns template_id, description, and list of placeholder fields.
Use template_id when calling fill.py for more accurate filling.

Agent calls:
    run_script("skills/docx-form-fill/tools/search_templates.py", '{"query": "thuê mặt bằng"}')
"""

from __future__ import annotations

import json


async def run(args: dict, ctx) -> dict:
    """Search templates by title/description. Returns field list."""
    from sqlalchemy import text as sa_text

    query = args.get("query", "")
    if not query:
        return {"error": "Cần cung cấp từ khóa tìm kiếm (query)"}

    result = await ctx.db.execute(
        sa_text(
            "SELECT id, title, description, original_filename, source_metadata "
            "FROM documents_document "
            "WHERE owner_id = :uid AND source_type = 'template' AND deleted_at IS NULL "
            "AND (title ILIKE :q OR description ILIKE :q OR original_filename ILIKE :q) "
            "ORDER BY updated_at DESC LIMIT 5"
        ),
        {"uid": ctx.user.id, "q": f"%{query}%"},
    )
    rows = result.fetchall()

    if not rows:
        return {"templates": [], "message": f"Không tìm thấy template nào matching '{query}'."}

    templates = []
    for r in rows:
        meta = r[4] or {}
        fields = meta.get("template_fields", [])
        source_doc = meta.get("source_document_id", "")
        templates.append({
            "template_id": str(r[0]),
            "source_document_id": source_doc,
            "title": r[1],
            "description": r[2] or "",
            "file": r[3],
            "field_count": len(fields),
            "fields": [f["placeholder"] for f in fields],
        })

    return {"templates": templates}
