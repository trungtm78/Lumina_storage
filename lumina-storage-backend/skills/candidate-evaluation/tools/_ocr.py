"""Text extraction with 3-layer fallback: markitdown → PyMuPDF → LLM Vision OCR.

Layer 1 (markitdown): Handles all formats (PDF, DOCX, XLSX, TXT, etc.)
Layer 2 (PyMuPDF):    Robust PDF text extraction. Handles corrupted PDFs
                     (e.g. missing /Root object) that pdfminer can't parse.
Layer 3 (LLM Vision): Image-based PDFs where the content is rendered as images.

Usage in tool scripts:
    from _ocr import extract_text

    text, filename = await extract_text(ctx, document_id)
"""

from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path

# Minimum text length to consider extraction successful
# Below this threshold → try next layer
MIN_TEXT_THRESHOLD = 200

# Absolute floor: below this, we refuse to return. Even OCR gibberish typically
# produces >50 chars, so anything less means all three layers genuinely failed.
# Calling code should surface this as an error rather than pass empty data to LLM.
UNUSABLE_TEXT_THRESHOLD = 50


class LowTextExtractionError(RuntimeError):
    """Raised when text extraction yields unusably short output from all layers.

    The caller should catch this and return a clear error to the user rather
    than feeding a near-empty CV to the LLM (which would produce hallucinated
    or nonsense structured data)."""

    def __init__(self, filename: str, char_count: int):
        self.filename = filename
        self.char_count = char_count
        super().__init__(
            f"Không trích xuất được nội dung từ '{filename}' "
            f"(chỉ có {char_count} ký tự). "
            "File có thể bị lỗi, bảo mật, hoặc là ảnh/scan chất lượng thấp."
        )

# DPI for rendering PDF pages to images (higher = clearer but larger)
RENDER_DPI = 200

# Max pages to OCR (most CVs are 1-2 pages)
MAX_OCR_PAGES = 3

OCR_SYSTEM_PROMPT = """Bạn là chuyên gia đọc và trích xuất text từ ảnh CV/Resume.

Nhiệm vụ: Đọc ẢNH CV này và trích xuất TẤT CẢ nội dung text có trong ảnh.

Quy tắc:
- Trích xuất CHÍNH XÁC text nhìn thấy trong ảnh, giữ nguyên ngôn ngữ gốc
- Giữ cấu trúc: heading, mục lục, danh sách, bảng
- Output dạng Markdown (heading, bullet points, etc.)
- KHÔNG bịa thêm thông tin không có trong ảnh
- KHÔNG dịch — giữ nguyên ngôn ngữ gốc của CV
- Nếu có bảng → format dạng markdown table
- Nếu có icon/symbol → bỏ qua, chỉ lấy text"""


async def _get_filename(ctx, document_id: str) -> str:
    """Look up original_filename from DB."""
    from sqlalchemy import text as sa_text

    result = await ctx.db.execute(
        sa_text("SELECT original_filename FROM documents_document WHERE id = :id"),
        {"id": document_id},
    )
    row = result.fetchone()
    return row[0] if row else "document"


def _extract_via_markitdown(doc_bytes: bytes, filename: str) -> str:
    """Layer 1: Standard extraction via markitdown. Returns '' on failure."""
    try:
        from markitdown import MarkItDown

        ext = Path(filename).suffix.lower()
        md = MarkItDown()
        converted = md.convert_stream(BytesIO(doc_bytes), file_extension=ext)
        return converted.text_content or ""
    except Exception:
        return ""


def _is_pdf(doc_bytes: bytes) -> bool:
    """Check if bytes are a PDF (tolerate leading whitespace/newlines)."""
    header = doc_bytes[:32].lstrip()
    return header.startswith(b"%PDF-")


def _extract_via_pymupdf(doc_bytes: bytes) -> str:
    """Layer 2: PyMuPDF text extraction. More robust than pdfminer.

    Handles:
      - PDFs with missing /Root object (corrupted trailer)
      - PDFs with leading whitespace before %PDF- header
      - Various structural issues pdfminer can't handle

    Returns '' if the file isn't a PDF or extraction fails.
    """
    if not _is_pdf(doc_bytes):
        return ""
    try:
        import fitz

        doc = fitz.open(stream=doc_bytes, filetype="pdf")
        try:
            parts = []
            for page in doc:
                page_text = page.get_text() or ""
                if page_text.strip():
                    parts.append(page_text)
            return "\n\n".join(parts)
        finally:
            doc.close()
    except Exception:
        return ""


def _is_image_based_pdf(doc_bytes: bytes, text: str) -> bool:
    """Detect image-based PDFs (little text + large images)."""
    if len(text.strip()) >= MIN_TEXT_THRESHOLD:
        return False

    if not _is_pdf(doc_bytes):
        return False

    try:
        import fitz

        doc = fitz.open(stream=doc_bytes, filetype="pdf")
        try:
            for page in doc:
                images = page.get_images(full=True)
                page_text = page.get_text().strip()
                if images and len(page_text) < MIN_TEXT_THRESHOLD:
                    return True
        finally:
            doc.close()
    except Exception:
        pass

    return False


def _render_pdf_pages_to_base64(doc_bytes: bytes) -> list[str]:
    """Render PDF pages to base64-encoded PNG images."""
    try:
        import fitz
    except ImportError:
        return []

    try:
        doc = fitz.open(stream=doc_bytes, filetype="pdf")
    except Exception:
        return []

    images = []
    try:
        for i, page in enumerate(doc):
            if i >= MAX_OCR_PAGES:
                break
            pix = page.get_pixmap(dpi=RENDER_DPI)
            png_bytes = pix.tobytes("png")
            b64 = base64.b64encode(png_bytes).decode("utf-8")
            images.append(b64)
    finally:
        doc.close()

    return images


async def _ocr_via_vision(ctx, images_b64: list[str]) -> str:
    """Layer 3: Send page images to LLM vision and extract text."""
    content: list[dict] = []

    for i, b64 in enumerate(images_b64):
        if len(images_b64) > 1:
            content.append({"type": "text", "text": f"--- Trang {i + 1} ---"})
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{b64}"},
        })

    content.append({"type": "text", "text": "Hãy trích xuất toàn bộ nội dung text từ ảnh CV trên."})

    return await ctx.llm_call([
        {"role": "system", "content": OCR_SYSTEM_PROMPT},
        {"role": "user", "content": content},
    ])


def _best(*texts: str) -> str:
    """Return the longest non-empty text."""
    return max(texts, key=lambda t: len(t.strip()), default="")


async def extract_text(ctx, document_id: str) -> tuple[str, str]:
    """Extract text from a document with 3-layer fallback.

    Flow:
        1. markitdown (handles all formats)
        2. PyMuPDF (fallback for corrupted PDFs)
        3. LLM Vision OCR (fallback for image-based PDFs)

    Returns:
        (text, filename) tuple
    """
    filename = await _get_filename(ctx, document_id)
    doc_bytes = await ctx.get_document_bytes(document_id)

    # ── Layer 1: markitdown ─────────────────────────────────────────────────
    text_md = _extract_via_markitdown(doc_bytes, filename)
    if len(text_md.strip()) >= MIN_TEXT_THRESHOLD:
        return text_md, filename

    # ── Layer 2: PyMuPDF (for PDFs that markitdown couldn't parse) ──────────
    text_pm = _extract_via_pymupdf(doc_bytes)
    best_so_far = _best(text_md, text_pm)

    if len(best_so_far.strip()) >= MIN_TEXT_THRESHOLD:
        return best_so_far, filename

    # ── Layer 3: LLM Vision OCR (for image-based PDFs) ──────────────────────
    if not _is_image_based_pdf(doc_bytes, best_so_far):
        # Not image-based and both layers failed → surface explicit error rather
        # than returning sparse text that would produce a hallucinated LLM parse.
        if len(best_so_far.strip()) < UNUSABLE_TEXT_THRESHOLD:
            raise LowTextExtractionError(filename, len(best_so_far.strip()))
        return best_so_far, filename

    images_b64 = _render_pdf_pages_to_base64(doc_bytes)
    if not images_b64:
        final = best_so_far
    else:
        try:
            ocr_text = await _ocr_via_vision(ctx, images_b64)
            final = _best(best_so_far, ocr_text or "")
        except Exception:
            final = best_so_far

    # Sanity gate: if even OCR produced unusable output, refuse to proceed.
    # Better to fail loudly here than feed empty text to the LLM and get a
    # hallucinated candidate profile with fabricated name/skills.
    if len(final.strip()) < UNUSABLE_TEXT_THRESHOLD:
        raise LowTextExtractionError(filename, len(final.strip()))

    return final, filename
