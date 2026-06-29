import asyncio
import base64
import logging
import os
import re
import tempfile
import unicodedata

from dataclasses import dataclass


@dataclass
class PageResult:
    page_number: int  # 1-indexed
    text: str
    confidence: float

logger = logging.getLogger(__name__)


def _nfc(s: str) -> str:
    """Chuẩn hóa NFC (tổ hợp dấu tiếng Việt) — Phase 5a T2. Rỗng/None → giữ nguyên."""
    return unicodedata.normalize("NFC", s) if s else s

_PPTX_EXTRACT_PROMPT = """Bạn là công cụ extract nội dung slide thành Markdown phục vụ RAG (Retrieval-Augmented Generation).

## Quy tắc extract TEXT:
- Copy CHÍNH XÁC toàn bộ text trong slide, KHÔNG tóm tắt, KHÔNG paraphrase, KHÔNG bỏ sót
- Dùng `#` cho title chính của slide
- Dùng `##` cho section heading / subtitle
- Dùng `- ` cho bullet points, giữ đúng độ indent nếu có nested
- Dùng `| |` cho table
- Giữ nguyên quote, số liệu, tên riêng, ký hiệu đặc biệt

## Quy tắc mô tả HÌNH ẢNH / BIỂU ĐỒ:
- Chỉ mô tả khi ảnh mang nội dung thông tin (chart, diagram, infographic, photo có context)
- Mô tả bằng CÙNG NGÔN NGỮ với text trong slide
- Format: `> [Hình: <mô tả ngắn gọn nội dung thông tin của ảnh>]`
- BỎ QUA: logo, icon trang trí, background, số trang, ảnh thuần trang trí

## Output:
- Chỉ trả về markdown, không giải thích
- Nếu slide hoàn toàn trống hoặc chỉ có ảnh trang trí → trả về chuỗi rỗng"""


class TextExtractionService:
    # Phase 4 T2 (M1): default max_tokens cho VLM ĐẶT Ở lớp tiêu thụ (không ở config
    # resolver). 8192 vì 1 trang A4 tiếng Việt dày + bảng + mô tả ảnh có thể vượt 4096
    # token markdown → tránh output cắt cụt. Override được qua vlm_kwargs/extra_config.
    _VLM_DEFAULT_MAX_TOKENS = 8192

    def __init__(
        self,
        gotenberg_url: str = "",
        vlm_model: str = "",
        vlm_kwargs: dict | None = None,
    ) -> None:
        self._gotenberg_url = gotenberg_url
        self._vlm_model = vlm_model
        # Copy để KHÔNG mutate dict của caller; đảm bảo LUÔN có max_tokens đủ lớn.
        self._vlm_kwargs = dict(vlm_kwargs or {})
        self._vlm_kwargs.setdefault("max_tokens", self._VLM_DEFAULT_MAX_TOKENS)

    async def extract(
        self, file_bytes: bytes, mime_type: str, extension: str
    ) -> list[PageResult]:
        """Trích xuất → list[PageResult]. Phase 5a T2: chuẩn hóa NFC tiếng Việt ở MỘT điểm
        (PyMuPDF/VLM/MarkItDown có thể trả NFD) cho mọi page trước khi trả về."""
        pages = await self._extract_dispatch(file_bytes, mime_type, extension)
        return [
            PageResult(page_number=p.page_number, text=_nfc(p.text), confidence=p.confidence)
            for p in pages
        ]

    async def _extract_dispatch(
        self, file_bytes: bytes, mime_type: str, extension: str
    ) -> list[PageResult]:
        if mime_type == "application/pdf" or extension == ".pdf":
            return await self._extract_pdf_hybrid(file_bytes)

        if mime_type.startswith("image/"):
            if self._vlm_model:
                return await self._extract_image_vlm(file_bytes, mime_type)
            logger.warning("No VLM model configured — cannot extract text from image")
            return []

        if extension == ".pptx" or "presentationml" in mime_type:
            return await self._extract_pptx(file_bytes)

        if extension == ".xlsx" or "spreadsheetml" in mime_type:
            return await self._extract_xlsx(file_bytes)

        # .doc (Word 97-2003 binary) — MarkItDown không đọc được binary format này;
        # dùng Gotenberg/LibreOffice convert sang PDF rồi extract như PDF.
        if extension == ".doc" or "msword" in mime_type:
            return await self._extract_doc(file_bytes)

        # DOCX + old formats (.xls, .ppt) → MarkItDown
        if extension in (".docx", ".xls", ".ppt") or "officedocument" in mime_type:
            return self._extract_with_markitdown(file_bytes, extension)

        if mime_type.startswith("text/") or extension in (".txt", ".md", ".csv"):
            return self._extract_plaintext(file_bytes)

        return []

    async def _extract_image_vlm(self, file_bytes: bytes, mime_type: str) -> list[PageResult]:
        import litellm

        b64 = base64.b64encode(file_bytes).decode()
        try:
            response = await litellm.acompletion(
                model=self._vlm_model,
                messages=[{"role": "user", "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}},
                    {"type": "text", "text": _PPTX_EXTRACT_PROMPT},
                ]}],
                **self._vlm_kwargs,
            )
            text = response.choices[0].message.content.strip()
            if text:
                return [PageResult(1, text, 1.0)]
        except Exception as e:
            logger.warning("Image VLM failed: %s", e)
        return []

    def _pdf_page_needs_vlm(self, page) -> bool:
        """Heuristic: dùng VLM nếu text không đủ để represent nội dung trang."""
        text = page.get_text("text").strip()
        if not text or len(text) < 50:
            return True
        if len(text) < 300:
            blocks = page.get_text("dict")["blocks"]
            page_area = page.rect.width * page.rect.height
            image_area = sum(
                (b["bbox"][2] - b["bbox"][0]) * (b["bbox"][3] - b["bbox"][1])
                for b in blocks if b["type"] == 1
            )
            if page_area and image_area / page_area > 0.3:
                return True
        return False

    async def _extract_pdf_hybrid(self, file_bytes: bytes) -> list[PageResult]:
        import fitz
        import litellm

        doc = fitz.open(stream=file_bytes, filetype="pdf")
        total = doc.page_count
        results: list[PageResult | None] = [None] * total

        logger.info("[PDF] start — %.1f KB, %d pages", len(file_bytes) / 1024, total)

        # Pass 1: classify pages → text vs VLM
        text_pages: list[tuple[int, str]] = []
        vlm_pages: list[int] = []

        for page in doc:
            i = page.number
            if self._vlm_model and self._pdf_page_needs_vlm(page):
                vlm_pages.append(i)
                logger.debug("[PDF] page %d/%d → VLM (low text or image-heavy)", i + 1, total)
            else:
                # Markdown mode (PyMuPDF ≥ 1.24) preserves table structure as | col | rows;
                # falls back to plain "text" on older versions or unsupported pages.
                try:
                    text = page.get_text("markdown").strip()
                except Exception:
                    text = page.get_text("text").strip()
                if text:
                    text_pages.append((i, text))
                    logger.debug("[PDF] page %d/%d → text (%d chars)", i + 1, total, len(text))
                else:
                    logger.debug("[PDF] page %d/%d → empty, skipped", i + 1, total)

        logger.info(
            "[PDF] classified: %d text page(s), %d VLM page(s), %d empty",
            len(text_pages), len(vlm_pages), total - len(text_pages) - len(vlm_pages),
        )

        # Fill text pages immediately
        for i, text in text_pages:
            results[i] = PageResult(i + 1, text, 1.0)

        # VLM pages: parallel render + LLM
        if vlm_pages:
            semaphore = asyncio.Semaphore(15)
            completed = 0

            async def process_vlm_page(i: int) -> None:
                nonlocal completed
                logger.info("[PDF] VLM page %d/%d — rendering...", i + 1, total)
                try:
                    img_bytes = doc[i].get_pixmap(dpi=150).tobytes("png")
                    b64 = base64.b64encode(img_bytes).decode()
                    logger.info("[PDF] VLM page %d/%d — calling LLM (%s)...", i + 1, total, self._vlm_model)
                    async with semaphore:
                        response = await litellm.acompletion(
                            model=self._vlm_model,
                            messages=[{"role": "user", "content": [
                                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                                {"type": "text", "text": _PPTX_EXTRACT_PROMPT},
                            ]}],
                            **self._vlm_kwargs,
                        )
                    text = response.choices[0].message.content.strip()
                    completed += 1
                    if text:
                        results[i] = PageResult(i + 1, text, 1.0)
                        logger.info(
                            "[PDF] VLM page %d/%d done (%d/%d) — %d chars",
                            i + 1, total, completed, len(vlm_pages), len(text),
                        )
                    else:
                        logger.info("[PDF] VLM page %d/%d done (%d/%d) — empty response", i + 1, total, completed, len(vlm_pages))
                except Exception as e:
                    completed += 1
                    logger.warning("[PDF] VLM page %d/%d failed (%d/%d): %s", i + 1, total, completed, len(vlm_pages), e)

            await asyncio.gather(*[process_vlm_page(i) for i in vlm_pages])

        doc.close()
        valid = [r for r in results if r is not None and r.text.strip()]
        logger.info("[PDF] done — %d/%d pages extracted", len(valid), total)
        return valid

    async def _extract_pptx(self, file_bytes: bytes) -> list[PageResult]:
        """Gotenberg → PDF → parallel render + VLM per slide."""
        if not self._gotenberg_url:
            logger.warning("PPTX: no Gotenberg URL configured, skipping")
            return []

        import httpx
        import fitz
        import litellm

        # 1. Gotenberg: PPTX → PDF
        try:
            async with httpx.AsyncClient(timeout=130) as client:
                resp = await client.post(
                    f"{self._gotenberg_url}/forms/libreoffice/convert",
                    files={"files": ("presentation.pptx", file_bytes,
                                     "application/vnd.openxmlformats-officedocument.presentationml.presentation")},
                )
        except Exception as e:
            logger.warning("PPTX: Gotenberg request failed: %s", e)
            return []

        if resp.status_code != 200:
            logger.warning("PPTX: Gotenberg returned status=%s", resp.status_code)
            return []

        pdf = fitz.open(stream=resp.content, filetype="pdf")
        total = pdf.page_count
        logger.info("PPTX: %d slides, starting parallel VLM extraction", total)

        # 2. Parallel: render slide → VLM (semaphore cap 15 concurrent)
        results: list[PageResult | None] = [None] * total
        semaphore = asyncio.Semaphore(15)

        async def process_slide(i: int) -> None:
            try:
                img_bytes = pdf[i].get_pixmap(dpi=150).tobytes("png")
                b64 = base64.b64encode(img_bytes).decode()
                async with semaphore:
                    response = await litellm.acompletion(
                        model=self._vlm_model,
                        messages=[{"role": "user", "content": [
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                            {"type": "text", "text": _PPTX_EXTRACT_PROMPT},
                        ]}],
                        **self._vlm_kwargs,
                    )
                text = response.choices[0].message.content.strip()
                if text:
                    results[i] = PageResult(i + 1, text, 1.0)
                    logger.info("PPTX slide %d: %d chars", i + 1, len(text))
            except Exception as e:
                logger.warning("PPTX slide %d VLM failed: %s", i + 1, e)

        await asyncio.gather(*[process_slide(i) for i in range(total)])
        pdf.close()

        final = [r for r in results if r is not None and r.text.strip()]
        logger.info("PPTX: %d/%d slides extracted", len(final), total)
        return final

    async def _extract_xlsx(self, file_bytes: bytes) -> list[PageResult]:
        # NOTE: In the ingest pipeline, Excel/CSV files are handled by a dedicated path
        # in ingest_document_task (via excel_rag_service) and never reach this method.
        # This fallback is kept for any direct use of TextExtractionService outside the pipeline.
        from markitdown import MarkItDown

        md = MarkItDown()
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            f.write(file_bytes)
            tmp_path = f.name
        try:
            result = md.convert(tmp_path)
            text = result.text_content.strip()
        finally:
            os.unlink(tmp_path)

        if not text:
            return []
        return [PageResult(1, text, 1.0)]

    def _make_markitdown_llm_client(self):
        """Wrap litellm as a MarkItDown-compatible LLM client."""
        if not self._vlm_model:
            return None, None
        import litellm
        from types import SimpleNamespace
        kwargs = self._vlm_kwargs

        class _Client:
            def __init__(self, model, kw):
                self._model = model
                self._kw = kw
                self.chat = SimpleNamespace(
                    completions=SimpleNamespace(create=self._create)
                )

            def _create(self, model, messages, **extra):
                return litellm.completion(model=self._model, messages=messages, **self._kw)

        return _Client(self._vlm_model, kwargs), self._vlm_model

    def _extract_with_markitdown(self, file_bytes: bytes, extension: str) -> list[PageResult]:
        from markitdown import MarkItDown

        llm_client, llm_model = self._make_markitdown_llm_client()
        md = MarkItDown(llm_client=llm_client, llm_model=llm_model)
        with tempfile.NamedTemporaryFile(suffix=extension, delete=False) as f:
            f.write(file_bytes)
            tmp_path = f.name
        try:
            result = md.convert(tmp_path)
            return [PageResult(1, result.text_content, 1.0)]
        finally:
            os.unlink(tmp_path)

    async def _extract_doc(self, file_bytes: bytes) -> list[PageResult]:
        """Word 97-2003 binary (.doc) → Gotenberg/LibreOffice → PDF → extract như PDF thường."""
        if self._gotenberg_url:
            import httpx

            try:
                async with httpx.AsyncClient(timeout=130) as client:
                    resp = await client.post(
                        f"{self._gotenberg_url}/forms/libreoffice/convert",
                        files={"files": ("document.doc", file_bytes, "application/msword")},
                    )
                if resp.status_code == 200:
                    logger.info("DOC: Gotenberg converted successfully (%.1f KB PDF)", len(resp.content) / 1024)
                    return await self._extract_pdf_hybrid(resp.content)
                logger.warning("DOC: Gotenberg returned status=%s, falling back to MarkItDown", resp.status_code)
            except Exception as e:
                logger.warning("DOC: Gotenberg request failed: %s, falling back to MarkItDown", e)

        # Fallback: MarkItDown (hỗ trợ hạn chế với binary .doc nhưng vẫn tốt hơn là không có gì)
        return self._extract_with_markitdown(file_bytes, ".doc")

    def _extract_plaintext(self, file_bytes: bytes) -> list[PageResult]:
        text = file_bytes.decode("utf-8", errors="replace")
        return [PageResult(1, text, 1.0)]
