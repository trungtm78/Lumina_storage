"""Load text from reference documents to embed in LLM prompts.

Phase 3 of the Document Generator project — Merchant use case: "tự soạn mới
hoặc dựa vô 1 số phụ lục đã được thông qua trước đó để tự lên nội dung". The
user picks 1+ approved reference documents; we fetch their extracted text and
hand it to the LLM as context for drafting a new doc in similar style/clauses.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.document import Document, DocumentContent


@dataclass
class ReferenceExcerpt:
    document_id: uuid.UUID
    title: str
    text: str
    truncated: bool


# Default per-document character budget. Picked to stay well under typical
# 32k-token model windows even with 5 references + drafting prompt.
DEFAULT_PER_DOC_CHARS = 6000
MAX_REFERENCE_DOCS = 5


def _coerce_uuid(raw: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(raw))
    except (ValueError, TypeError):
        return None


async def load_reference_excerpts(
    db: AsyncSession,
    document_ids: list[str],
    owner_id: uuid.UUID,
    per_doc_chars: int = DEFAULT_PER_DOC_CHARS,
) -> list[ReferenceExcerpt]:
    """Fetch the raw text of each reference document, scoped to the owner.

    Documents that don't exist, are soft-deleted, owned by someone else, or
    haven't been content-extracted yet are silently skipped — the LLM still
    drafts something even if a reference is missing rather than failing the
    request.
    """
    cleaned: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for raw in document_ids:
        u = _coerce_uuid(raw)
        if u is None or u in seen:
            continue
        seen.add(u)
        cleaned.append(u)

    if not cleaned:
        return []

    cleaned = cleaned[:MAX_REFERENCE_DOCS]

    rows = (
        await db.execute(
            select(Document, DocumentContent)
            .join(DocumentContent, DocumentContent.document_id == Document.id, isouter=True)
            .where(
                Document.id.in_(cleaned),
                Document.owner_id == owner_id,
                Document.deleted_at.is_(None),
            )
        )
    ).all()

    by_id = {doc.id: (doc, content) for doc, content in rows}

    out: list[ReferenceExcerpt] = []
    for doc_id in cleaned:
        pair = by_id.get(doc_id)
        if not pair:
            continue
        doc, content = pair
        text = (content.raw_text if content else "") or ""
        text = text.strip()
        if not text:
            continue
        truncated = False
        if len(text) > per_doc_chars:
            text = text[:per_doc_chars].rstrip() + "\n…(truncated)"
            truncated = True
        out.append(
            ReferenceExcerpt(
                document_id=doc.id,
                title=doc.title,
                text=text,
                truncated=truncated,
            )
        )

    return out


def format_reference_block(excerpts: list[ReferenceExcerpt]) -> str:
    """Render the loaded excerpts as a single string suitable for LLM context.

    Returns an empty string when there are no excerpts so callers can append
    unconditionally without producing dangling section headers.
    """
    if not excerpts:
        return ""
    parts: list[str] = ["Tài liệu tham khảo (do user chọn từ kho phụ lục đã được duyệt trước đó):"]
    for idx, ex in enumerate(excerpts, start=1):
        parts.append(f"\n--- [Tham khảo {idx}: {ex.title}] ---")
        parts.append(ex.text)
        if ex.truncated:
            parts.append("(*nội dung trên đã bị cắt ngắn để vừa context window.*)")
    parts.append(
        "\n\nHãy bám sát giọng văn, cấu trúc điều khoản, định dạng và các "
        "thuật ngữ pháp lý trong các phụ lục tham khảo trên. Không sao chép "
        "nguyên văn — viết mới phù hợp với yêu cầu cụ thể bên dưới."
    )
    return "\n".join(parts)
