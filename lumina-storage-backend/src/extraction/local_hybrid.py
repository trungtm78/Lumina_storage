"""Phase 5b — LocalHybridProvider: bọc pipeline trích xuất NỘI BỘ hiện tại
(TextExtractionService cho pdf/image/pptx/docx/plaintext + parse_xlsx_to_page_results cho
Excel/CSV) sau interface ExtractionProvider. Mặc định + fallback cuối (luôn khả dụng, miễn phí).

Provider DUMB: nhận vlm params đã resolve (caller/selector resolve vlm config theo đúng
hành vi cũ — Excel KHÔNG cần vlm). Zero-regression so với luồng cũ.
"""
from src.extraction.base import ExtractionProvider
from src.services.excel_rag_service import parse_xlsx_to_page_results
from src.services.text_extraction_service import PageResult, TextExtractionService

_EXCEL_EXTENSIONS = {".xlsx", ".xls", ".csv"}


class LocalHybridProvider(ExtractionProvider):
    name = "local_hybrid"

    def __init__(
        self, *, gotenberg_url: str = "", vlm_model: str = "", vlm_kwargs: dict | None = None
    ) -> None:
        self._gotenberg_url = gotenberg_url
        self._vlm_model = vlm_model
        self._vlm_kwargs = vlm_kwargs or {}

    async def extract(
        self, file_bytes: bytes, mime_type: str, extension: str
    ) -> list[PageResult]:
        if extension in _EXCEL_EXTENSIONS:
            # Excel/CSV: RAGFlow-style 1 row = 1 PageResult (bypass TextExtractionService).
            return parse_xlsx_to_page_results(file_bytes)
        extractor = TextExtractionService(
            gotenberg_url=self._gotenberg_url,
            vlm_model=self._vlm_model,
            vlm_kwargs=self._vlm_kwargs,
        )
        return await extractor.extract(file_bytes, mime_type, extension)

    async def test_connection(self) -> tuple[bool, str]:
        return True, "LocalHybrid (nội bộ, luôn khả dụng)"
