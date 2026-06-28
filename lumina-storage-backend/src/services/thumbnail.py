import io
import logging

import httpx
import fitz  # pymupdf

logger = logging.getLogger(__name__)

from src.services.storage import StorageBackend


# MIME types that Gotenberg can convert to PDF
_GOTENBERG_MIME_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # docx
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",  # pptx
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # xlsx
    "application/msword",  # doc
    "application/vnd.ms-powerpoint",  # ppt
    "application/vnd.ms-excel",  # xls
    "text/plain",
    "text/html",
}

_PDF_MIME = "application/pdf"
_IMAGE_MIME_PREFIXES = ("image/jpeg", "image/png", "image/webp", "image/gif")


async def generate_thumbnail(
    file_bytes: bytes,
    mime_type: str,
    gotenberg_url: str,
    width: int = 400,
) -> bytes | None:
    """
    Generate a PNG thumbnail from file bytes.
    Returns PNG bytes or None if unsupported format.
    """
    pdf_bytes: bytes | None = None

    if mime_type == _PDF_MIME:
        pdf_bytes = file_bytes

    elif mime_type in _GOTENBERG_MIME_TYPES:
        pdf_bytes = await _convert_to_pdf_via_gotenberg(file_bytes, mime_type, gotenberg_url)

    elif any(mime_type.startswith(p) for p in _IMAGE_MIME_PREFIXES):
        return await _thumbnail_image(file_bytes, width)

    if pdf_bytes is None:
        return None

    return _render_pdf_first_page(pdf_bytes, width)


async def _convert_to_pdf_via_gotenberg(
    file_bytes: bytes, mime_type: str, gotenberg_url: str
) -> bytes | None:
    ext_map = {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "application/msword": "doc",
        "application/vnd.ms-powerpoint": "ppt",
        "application/vnd.ms-excel": "xls",
        "text/plain": "txt",
        "text/html": "html",
    }
    ext = ext_map.get(mime_type, "bin")

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{gotenberg_url}/forms/libreoffice/convert",
            files={"files": (f"document.{ext}", file_bytes, mime_type)},
        )
        if resp.status_code != 200:
            logger.warning("Gotenberg conversion failed: status=%s body=%s", resp.status_code, resp.text[:200])
            return None
        return resp.content


def _render_pdf_first_page(pdf_bytes: bytes, width: int) -> bytes:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    scale = width / page.rect.width
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    doc.close()
    return pix.tobytes("png")


async def _thumbnail_image(file_bytes: bytes, width: int) -> bytes:
    # Use fitz to resize image
    doc = fitz.open(stream=file_bytes)
    page = doc[0]
    scale = width / page.rect.width
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    doc.close()
    return pix.tobytes("png")


async def save_thumbnail(
    thumbnail_bytes: bytes,
    backend: StorageBackend,
) -> str:
    """Save thumbnail PNG to storage, return file_path."""
    result = await backend.save(thumbnail_bytes, "thumbnail.png")
    return result.file_path
