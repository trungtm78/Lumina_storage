"""Phase 5b — interface ExtractionProvider (Strategy pattern).

Mọi provider (LocalHybrid + Gemini/Mistral/Azure/Landing AI) implement `extract` chuẩn hóa
về `list[PageResult]` (page_number/text/confidence) — GIỮ contract hiện tại, downstream
(NFC/chunk/embed/retrieval Phase 5a) KHÔNG đổi.
"""
from abc import ABC, abstractmethod

from src.services.text_extraction_service import PageResult


class ExtractionProvider(ABC):
    name: str = "base"
    # Module SDK optional cần để chạy provider (None = luôn khả dụng, vd LocalHybrid/Gemini-litellm).
    sdk_module: str | None = None

    @classmethod
    def is_available(cls) -> bool:
        """Provider dùng được? (SDK optional đã cài). find_spec không import → rẻ.
        find_spec RAISE ModuleNotFoundError nếu parent package thiếu (vd 'azure') → bắt → False."""
        if not cls.sdk_module:
            return True
        import importlib.util

        try:
            return importlib.util.find_spec(cls.sdk_module) is not None
        except (ImportError, ValueError):
            return False

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
