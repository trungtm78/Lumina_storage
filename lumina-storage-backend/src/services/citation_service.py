"""Phase 7 — build ChatMessageSource từ collector.search_results (Citation dicts).

Tách khỏi chat_service.py (god-service): pure transformation, không I/O, không phụ thuộc
ChatService. Resilient với skill `_sources` lỗi (tránh poison commit/crash chat).
"""
from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from src.models.chat import ChatMessageSource

if TYPE_CHECKING:
    from src.services.agent import Citation

logger = logging.getLogger(__name__)


def _coerce_uuid(v) -> uuid.UUID | None:
    """UUID nếu hợp lệ (UUID hoặc str UUID), None nếu không — dùng cho cột UUID FK."""
    if isinstance(v, uuid.UUID):
        return v
    if isinstance(v, str):
        try:
            return uuid.UUID(v)
        except ValueError:
            return None
    return None


def citation_to_source(
    c: "Citation", message_id, citation_index: int
) -> ChatMessageSource:
    """Phase 4 T6 — map MỘT Citation dict (collector.search_results) → ChatMessageSource.

    Một shape duy nhất (dict) sau khi xóa query_vector_db: dùng .get() resilient cho
    cả rag_search lẫn parse_document `_sources` (có thể thiếu key). document_id/chunk_id
    coerce str→UUID (chunk_id không-UUID → None, cột nullable). excerpt rỗng → None
    (đồng nhất simple-chat path). Caller (citations_to_sources) đã đảm bảo document_id
    hợp lệ trước khi gọi."""
    content = c.get("content") or ""
    return ChatMessageSource(
        message_id=message_id,
        document_id=_coerce_uuid(c.get("document_id")),
        chunk_id=_coerce_uuid(c.get("chunk_id")),
        citation_index=citation_index,
        page_number=c.get("page_number"),
        relevance_score=c.get("score"),
        excerpt=content[:500] if content else None,
    )


def citations_to_sources(citations, message_id) -> list[ChatMessageSource]:
    """Phase 4 T6 — build list ChatMessageSource từ collector.search_results (Citation
    dicts). Resilient với skill _sources lỗi (tránh poison commit/crash chat): BỎ entry
    không phải dict, hoặc document_id thiếu/không-UUID (cột NOT NULL FK). citation_index
    liên tục 1..N theo entry hợp lệ (không gap). Entry bị bỏ → log cảnh báo (không im lặng)."""
    sources: list[ChatMessageSource] = []
    for c in citations:
        if not isinstance(c, dict) or _coerce_uuid(c.get("document_id")) is None:
            logger.warning("Bỏ citation lỗi (không dict hoặc document_id không hợp lệ): %r", c)
            continue
        sources.append(citation_to_source(c, message_id, len(sources) + 1))
    return sources
