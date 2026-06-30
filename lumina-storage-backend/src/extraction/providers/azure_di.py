"""Phase 5b Task 6 — AzureDIProvider: Azure Document Intelligence (layout/table/form mạnh,
on-prem container). SDK `azure-ai-documentintelligence` OPTIONAL (lazy import). Dùng model
'prebuilt-layout' output markdown; cắt content theo page spans → PageResult per trang.

Cần endpoint (base_url) + key (api_key). begin_analyze_document sync → asyncio.to_thread.
"""
import asyncio

from src.extraction.base import ExtractionProvider
from src.services.text_extraction_service import PageResult

_DEFAULT_MODEL = "prebuilt-layout"


class AzureDIProvider(ExtractionProvider):
    name = "azure_di"

    def __init__(
        self, *, api_key: str | None, model: str = _DEFAULT_MODEL,
        base_url: str | None = None, options: dict | None = None,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._base_url = base_url  # Azure DI endpoint
        self._options = options or {}

    @classmethod
    def from_config(cls, *, settings, api_key=None, base_url=None, options=None):
        opts = options or {}
        return cls(
            api_key=api_key, model=opts.get("model", _DEFAULT_MODEL),
            base_url=base_url, options=opts,
        )

    def _client(self):
        from azure.ai.documentintelligence import DocumentIntelligenceClient
        from azure.core.credentials import AzureKeyCredential

        return DocumentIntelligenceClient(
            endpoint=self._base_url, credential=AzureKeyCredential(self._api_key or "")
        )

    async def extract(self, file_bytes, mime_type, extension):
        client = self._client()

        def _run():
            poller = client.begin_analyze_document(
                self._model, body=file_bytes,
                content_type="application/octet-stream", output_content_format="markdown",
                # codex P2: offset span theo unicode code point khớp Python str slicing — BẮT BUỘC
                # cho tiếng Việt (dấu/combining mark) tránh cắt sai vị trí (default có thể utf16).
                string_index_type="unicodeCodePoint",
            )
            return poller.result()

        result = await asyncio.to_thread(_run)
        content = getattr(result, "content", "") or ""
        pages = getattr(result, "pages", None) or []
        if not pages:
            return [PageResult(1, content.strip(), 1.0)] if content.strip() else []
        out: list[PageResult] = []
        for page in pages:
            spans = getattr(page, "spans", None) or []
            text = "".join(content[s.offset:s.offset + s.length] for s in spans).strip()
            pn = getattr(page, "page_number", None) or (len(out) + 1)
            out.append(PageResult(page_number=pn, text=text, confidence=1.0))
        return out

    async def test_connection(self):
        if not self._base_url:
            return False, "Azure DI cần endpoint (base_url)"
        if not self._api_key:
            return False, "Azure DI cần api_key"
        try:
            self._client()  # dựng client (import SDK + credential)
            return True, "Azure DI OK (client sẵn sàng; verify đầy đủ khi extract)"
        except ImportError:
            return False, "Azure DI SDK (azure-ai-documentintelligence) chưa cài"
        except Exception as e:  # noqa: BLE001
            return False, f"Azure DI lỗi: {str(e)[:200]}"
