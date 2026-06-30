"""Phase 5b Task 7 — LandingAIProvider: Landing AI Agentic Document Extraction (ADE/DPT).
RAG-optimized: semantic chunking giữ phân cấp + coordinate grounding; mạnh bảng/form. SDK
`agentic-doc` OPTIONAL (lazy import; key qua env VISION_AGENT_API_KEY).

ADE trả chunks (text + grounding[page,bbox]); gộp text theo page → PageResult per trang
(giữ contract PageResult, bbox/grounding bỏ — NOT in scope, ghi backlog). parse sync →
asyncio.to_thread; ghi bytes ra temp file (parse nhận file path).
"""
import asyncio
import os
import tempfile

from src.extraction.base import ExtractionProvider
from src.services.text_extraction_service import PageResult


def _attr(obj, key, default=None):
    """Đọc thuộc tính từ object HOẶC dict (SDK có thể trả pydantic/object hoặc dict-like)."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _chunk_page(chunk) -> int:
    """Số trang (0-based) của chunk từ grounding (object/dict); fallback 0."""
    grounding = _attr(chunk, "grounding")
    if grounding:
        page = _attr(grounding[0], "page")
        if isinstance(page, int):
            return page
    page = _attr(chunk, "page")
    return page if isinstance(page, int) else 0


class LandingAIProvider(ExtractionProvider):
    name = "landing_ai"
    sdk_module = "agentic_doc"  # optional SDK

    def __init__(
        self, *, api_key: str | None, base_url: str | None = None, options: dict | None = None,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url
        self._options = options or {}

    @classmethod
    def from_config(cls, *, settings, api_key=None, base_url=None, options=None):
        return cls(api_key=api_key, base_url=base_url, options=options or {})

    def _parse_fn(self):
        from agentic_doc.parse import parse  # lazy + optional

        return parse

    async def extract(self, file_bytes, mime_type, extension):
        parse = self._parse_fn()

        def _run():
            fd, path = tempfile.mkstemp(suffix=extension or ".pdf")  # path biết NGAY → cleanup chắc
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(file_bytes)
                # codex P2: set+restore env quanh parse (tránh dùng nhầm key giữa config/concurrent).
                old = os.environ.get("VISION_AGENT_API_KEY")
                if self._api_key:
                    os.environ["VISION_AGENT_API_KEY"] = self._api_key
                try:
                    return parse(path)
                finally:
                    if self._api_key:
                        if old is None:
                            os.environ.pop("VISION_AGENT_API_KEY", None)
                        else:
                            os.environ["VISION_AGENT_API_KEY"] = old
            finally:
                try:
                    os.unlink(path)
                except OSError:
                    pass

        results = await asyncio.to_thread(_run)
        docs = results if isinstance(results, list) else [results]
        if not docs or docs[0] is None:
            return []
        doc = docs[0]
        chunks = _attr(doc, "chunks") or []
        if not chunks:
            md = (_attr(doc, "markdown", "") or "").strip()
            return [PageResult(1, md, 1.0)] if md else []
        by_page: dict[int, list[str]] = {}
        for ch in chunks:
            text = (_attr(ch, "text", "") or "").strip()
            if text:
                by_page.setdefault(_chunk_page(ch), []).append(text)
        return [
            PageResult(page_number=page + 1, text="\n\n".join(parts).strip(), confidence=1.0)
            for page, parts in sorted(by_page.items())
        ]

    async def test_connection(self):
        if not self._api_key:
            return False, "Landing AI cần api_key (VISION_AGENT_API_KEY)"
        try:
            self._parse_fn()  # import SDK
            return True, "Landing AI OK (SDK sẵn sàng; verify đầy đủ khi extract)"
        except ImportError:
            return False, "Landing AI SDK (agentic-doc) chưa cài"
        except Exception as e:  # noqa: BLE001
            return False, f"Landing AI lỗi: {str(e)[:200]}"
