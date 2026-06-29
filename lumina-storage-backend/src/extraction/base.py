"""Phase 5b — interface ExtractionProvider (Strategy pattern).

Mọi provider (LocalHybrid + Gemini/Mistral/Azure/Landing AI) implement `extract` chuẩn hóa
về `list[PageResult]` (page_number/text/confidence) — GIỮ contract hiện tại, downstream
(NFC/chunk/embed/retrieval Phase 5a) KHÔNG đổi.
"""
from abc import ABC, abstractmethod

from src.services.text_extraction_service import PageResult


class ExtractionProvider(ABC):
    name: str = "base"

    @abstractmethod
    async def extract(
        self, file_bytes: bytes, mime_type: str, extension: str
    ) -> list[PageResult]:
        """Trích xuất tài liệu → list[PageResult] chuẩn hóa."""
        ...

    async def test_connection(self) -> tuple[bool, str]:
        """Kiểm tra provider sẵn sàng (credential/SDK). Trả (ok, message). Default OK."""
        return True, "OK"

    @classmethod
    def from_config(
        cls, *, settings, api_key: str | None = None, base_url: str | None = None,
        options: dict | None = None,
    ) -> "ExtractionProvider":
        """Dựng provider từ config (cho selector + test_connection). Provider ngoài override
        dùng api_key/base_url/options; LocalHybrid dùng settings.gotenberg_url."""
        raise NotImplementedError(f"{cls.__name__} chưa hỗ trợ from_config")
