"""Phase 5b Task 5 — MistralProvider: trích xuất qua Mistral OCR API (structured markdown +
bbox; 170 ngôn ngữ; self-host được). SDK `mistralai` OPTIONAL (lazy import; chưa cài → provider
ẩn ở T8 / test_connection báo lỗi). Mistral OCR sync → chạy qua asyncio.to_thread.
"""
import asyncio
import base64

from src.extraction.base import ExtractionProvider
from src.extraction.providers._mime import canonical_mime
from src.services.text_extraction_service import PageResult

_DEFAULT_MODEL = "mistral-ocr-latest"


class MistralProvider(ExtractionProvider):
    name = "mistral"

    def __init__(
        self, *, api_key: str | None, model: str = _DEFAULT_MODEL,
        base_url: str | None = None, options: dict | None = None,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._base_url = base_url
        self._options = options or {}

    @classmethod
    def from_config(cls, *, settings, api_key=None, base_url=None, options=None):
        opts = options or {}
        return cls(
            api_key=api_key, model=opts.get("model", _DEFAULT_MODEL),
            base_url=base_url, options=opts,
        )

    def _client(self):
        # lazy + optional; robust 2 biến thể đường import SDK (codex: v1.x top-level vs .client).
        try:
            from mistralai import Mistral
        except ImportError:
            from mistralai.client import Mistral

        kwargs = {"api_key": self._api_key}
        if self._base_url:
            kwargs["server_url"] = self._base_url  # self-host
        return Mistral(**kwargs)

    async def extract(self, file_bytes, mime_type, extension):
        client = self._client()
        b64 = base64.b64encode(file_bytes).decode()
        mime = canonical_mime(mime_type, extension)  # codex P2: octet-stream → từ extension
        # PDF/doc → document_url; ảnh → image_url (shape Mistral OCR).
        doc_type = "image_url" if mime.startswith("image/") else "document_url"
        document = {"type": doc_type, doc_type: f"data:{mime};base64,{b64}"}
        resp = await asyncio.to_thread(
            client.ocr.process, model=self._model, document=document
        )
        pages = getattr(resp, "pages", None) or []
        out: list[PageResult] = []
        for p in pages:
            idx = getattr(p, "index", None)
            md = (getattr(p, "markdown", "") or "").strip()
            out.append(PageResult(
                page_number=(idx + 1) if isinstance(idx, int) else len(out) + 1,
                text=md, confidence=1.0,
            ))
        return out

    async def test_connection(self):
        try:
            client = self._client()
            await asyncio.to_thread(client.models.list)
            return True, "Mistral OK"
        except ImportError:
            return False, "Mistral SDK (mistralai) chưa cài"
        except Exception as e:  # noqa: BLE001
            return False, f"Mistral lỗi: {str(e)[:200]}"
