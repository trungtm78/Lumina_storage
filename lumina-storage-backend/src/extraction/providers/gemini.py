"""Phase 5b Task 4 — GeminiProvider: trích xuất qua Google Gemini (multimodal, đọc PDF/ảnh
native nhiều trang). Dùng litellm (đã có dep, hỗ trợ 'gemini/<model>') — không cần SDK riêng.

Gemini trả MỘT khối markdown; prompt yêu cầu phân tách trang bằng '---PAGE-BREAK---' →
parse thành list[PageResult]. Credential = api_key của config (không qua DB AI Model Config).
"""
import base64

from src.extraction.base import ExtractionProvider
from src.services.text_extraction_service import PageResult

_PAGE_DELIM = "---PAGE-BREAK---"
_DEFAULT_MODEL = "gemini-2.0-flash"
# Canonicalize MIME từ extension khi mime rỗng/generic (vd application/octet-stream từ import).
_EXT_MIME = {
    ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".tiff": "image/tiff", ".bmp": "image/bmp",
}


def _canonical_mime(mime_type: str, extension: str) -> str:
    if mime_type and mime_type != "application/octet-stream":
        return mime_type
    return _EXT_MIME.get((extension or "").lower(), mime_type or "application/pdf")
_PROMPT = (
    "Trích xuất TOÀN BỘ nội dung tài liệu thành markdown, giữ cấu trúc (heading, bảng, danh "
    f"sách). Phân tách MỖI trang bằng đúng dòng '{_PAGE_DELIM}'. Chỉ trả nội dung, không giải thích."
)


class GeminiProvider(ExtractionProvider):
    name = "gemini"

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

    def _extra_kwargs(self) -> dict:
        return {k: v for k, v in self._options.items() if k != "model"}

    async def extract(self, file_bytes, mime_type, extension):
        import litellm

        b64 = base64.b64encode(file_bytes).decode()
        mime = _canonical_mime(mime_type, extension)
        data_url = f"data:{mime};base64,{b64}"
        # Ảnh → image_url; PDF/tài liệu → litellm 'file' content (đúng shape document input).
        if mime.startswith("image/"):
            file_part = {"type": "image_url", "image_url": {"url": data_url}}
        else:
            file_part = {"type": "file", "file": {"file_data": data_url}}
        messages = [{"role": "user", "content": [{"type": "text", "text": _PROMPT}, file_part]}]
        resp = await litellm.acompletion(
            model=f"gemini/{self._model}", api_key=self._api_key, messages=messages,
            **self._extra_kwargs(),
        )
        content = (resp.choices[0].message.content or "").strip()
        if not content:
            return []
        # GIỮ số trang đúng: strip mỗi segment, chỉ bỏ segment RỖNG ở đầu/cuối (artifact delimiter),
        # KHÔNG bỏ blank ở GIỮA (tránh renumber sai trang) — codex P2.
        segs = [s.strip() for s in content.split(_PAGE_DELIM)]
        while segs and not segs[0]:
            segs.pop(0)
        while segs and not segs[-1]:
            segs.pop()
        return [PageResult(page_number=i, text=s, confidence=1.0) for i, s in enumerate(segs, 1)]

    async def test_connection(self):
        import litellm

        try:
            await litellm.acompletion(
                model=f"gemini/{self._model}", api_key=self._api_key,
                messages=[{"role": "user", "content": "ping"}], max_tokens=5,
            )
            return True, "Gemini OK"
        except Exception as e:  # noqa: BLE001
            return False, f"Gemini lỗi: {str(e)[:200]}"
