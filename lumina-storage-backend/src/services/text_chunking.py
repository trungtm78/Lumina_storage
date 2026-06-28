"""Vietnamese-aware sentence chunking.

LangChain's `RecursiveCharacterTextSplitter` falls back to splitting on `". "`,
which mishandles Vietnamese: it ignores the `?`/`!`/`…` terminators, breaks on
abbreviations (`GS.`, `T.S.`), and produces chunks that begin or end mid-sentence.
This module sentence-tokenizes with `underthesea` and only splits between
sentence boundaries, so a chunk is always a coherent sequence of complete
sentences — better RAG retrieval, fewer hallucinations.
"""

from __future__ import annotations

import logging
from typing import Iterable

logger = logging.getLogger(__name__)

try:  # underthesea is heavy and optional in dev environments without VN content
    from underthesea import sent_tokenize as _vi_sent_tokenize  # type: ignore

    _UNDERTHESEA_AVAILABLE = True
except Exception:  # pragma: no cover - dependency not installed
    _UNDERTHESEA_AVAILABLE = False


def _fallback_sentences(text: str) -> list[str]:
    """Naive sentence split when underthesea isn't available — keeps things working."""
    import re

    parts = re.split(r"(?<=[.!?…])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def split_sentences(text: str) -> list[str]:
    """Best-effort Vietnamese-aware sentence split, with a regex fallback."""
    if not text or not text.strip():
        return []
    if _UNDERTHESEA_AVAILABLE:
        try:
            sentences = _vi_sent_tokenize(text)
            return [s.strip() for s in sentences if s and s.strip()]
        except Exception:  # pragma: no cover - underthesea internals
            logger.exception("underthesea sent_tokenize failed; falling back to regex")
    return _fallback_sentences(text)


def chunk_by_sentences(
    text: str,
    chunk_size: int = 1500,
    chunk_overlap: int = 150,
) -> list[str]:
    """Group sentences into chunks of roughly `chunk_size` characters.

    `chunk_overlap` is honored by re-introducing the trailing sentences of the
    previous chunk at the start of the next one — this keeps semantic context
    across chunk boundaries the way the LangChain splitter does, but on whole
    sentences rather than arbitrary characters.
    """
    sentences = split_sentences(text)
    if not sentences:
        return [text] if text.strip() else []

    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for sent in sentences:
        # If a single sentence is bigger than chunk_size we keep it intact —
        # truncating sentences is worse for RAG than an oversized chunk.
        sent_len = len(sent) + 1
        if current and current_len + sent_len > chunk_size:
            chunks.append(" ".join(current).strip())
            # build overlap from the tail of the previous chunk
            overlap_buf: list[str] = []
            overlap_len = 0
            for prev in reversed(current):
                overlap_buf.insert(0, prev)
                overlap_len += len(prev) + 1
                if overlap_len >= chunk_overlap:
                    break
            current = overlap_buf
            current_len = sum(len(s) + 1 for s in current)
        current.append(sent)
        current_len += sent_len

    if current:
        chunks.append(" ".join(current).strip())

    return [c for c in chunks if c]


def chunk_iter(texts: Iterable[str], **kwargs) -> list[str]:
    """Convenience: chunk multiple texts and concatenate the result."""
    out: list[str] = []
    for t in texts:
        out.extend(chunk_by_sentences(t, **kwargs))
    return out
