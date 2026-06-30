"""Phase 5b — canonicalize MIME từ extension khi mime rỗng/generic (octet-stream từ import).
Dùng chung cho adapter multimodal (Gemini, Mistral...) để chọn đúng data-url MIME + route
image vs document."""

_EXT_MIME = {
    ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".tiff": "image/tiff", ".tif": "image/tiff",
    ".bmp": "image/bmp",
}


def canonical_mime(mime_type: str, extension: str) -> str:
    if mime_type and mime_type != "application/octet-stream":
        return mime_type
    return _EXT_MIME.get((extension or "").lower(), mime_type or "application/pdf")
