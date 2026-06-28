"""Magic-byte file content validation for uploads.

The extension declared by a client is untrusted — an attacker can rename
malware.exe -> harmless.pdf and slip past extension-only checks. We sniff the
real MIME type from the first bytes and require it to match the declared
extension before the file ever hits storage / parsers.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# python-magic loads libmagic via ctypes. On Windows without libmagic.dll the
# C-side access violation can corrupt the Python process even though the OSError
# is caught — observed during this remediation as a delayed segfault on the next
# import. Probe with importlib.util.find_spec FIRST and only attempt the real
# import on platforms where libmagic is reliably available (Linux containers).
import importlib.util
import sys

_MAGIC_AVAILABLE = False
magic = None  # type: ignore

if sys.platform != "win32":
    if importlib.util.find_spec("magic") is not None:
        try:
            import magic  # type: ignore

            _MAGIC_AVAILABLE = True
        except (ImportError, OSError):  # pragma: no cover - env-dependent
            _MAGIC_AVAILABLE = False
            magic = None  # type: ignore

# Production must NEVER fall through with libmagic missing — that's how the E-7
# control got bypassed in the first place. We refuse to start serving uploads.
_PROD_LIBMAGIC_CHECKED = False


def _ensure_libmagic_in_prod() -> None:
    """Fail closed in production if libmagic isn't available.

    Dev/test on Windows often lacks the libmagic binding; that's fine. But the
    Docker image MUST install libmagic1 so file content sniffing actually runs.
    Detecting this at first-use beats failing silently on every upload.
    """
    global _PROD_LIBMAGIC_CHECKED
    if _PROD_LIBMAGIC_CHECKED:
        return
    _PROD_LIBMAGIC_CHECKED = True

    # Lazy import keeps file_validation importable in test/tooling contexts that
    # don't have settings wired up yet.
    from src.core.config import get_settings

    settings = get_settings()
    if settings.app_env == "production" and not _MAGIC_AVAILABLE:
        raise RuntimeError(
            "libmagic is not installed in this environment but app_env=production. "
            "File-content validation cannot run. Install libmagic1 in the Docker image "
            "or set app_env to a non-production value."
        )


# Hard allowlist for /api/v1/documents/upload. ANY extension not in this set is
# rejected at the API boundary, before storage. Without this, .py / .sh / .so /
# .exe uploads land in /app/uploads where the agent's run_script tool would
# happily execute them. Extension-based gating is a coarse but effective control:
# even if libmagic is missing in some environment, extensions still filter.
UPLOAD_ALLOWED_EXTENSIONS: set[str] = {
    ".pdf",
    ".doc", ".docx",
    ".xls", ".xlsx",
    ".ppt", ".pptx",
    ".txt", ".md", ".csv", ".tsv",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
    ".html", ".json",
    ".rtf", ".odt", ".ods", ".odp",
}


# Map declared extension -> set of MIME types we will accept.
# Some Office formats sniff as "application/zip" because they ARE zips, hence
# the broader fallback set.
ALLOWED_MIME_BY_EXT: dict[str, set[str]] = {
    ".pdf": {"application/pdf"},
    ".docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/zip",
        "application/octet-stream",
    },
    ".doc": {"application/msword", "application/octet-stream"},
    ".xlsx": {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/zip",
        "application/octet-stream",
    },
    ".xls": {"application/vnd.ms-excel", "application/octet-stream"},
    ".pptx": {
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/zip",
        "application/octet-stream",
    },
    ".ppt": {"application/vnd.ms-powerpoint", "application/octet-stream"},
    ".txt": {"text/plain"},
    ".md": {"text/plain", "text/markdown"},
    ".csv": {"text/plain", "text/csv", "application/csv"},
    ".png": {"image/png"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".gif": {"image/gif"},
    ".webp": {"image/webp"},
    ".svg": {"image/svg+xml", "text/xml", "text/plain"},
    ".ico": {"image/x-icon", "image/vnd.microsoft.icon"},
    ".html": {"text/html"},
    ".json": {"application/json", "text/plain"},
}


def detect_mime(data: bytes) -> str | None:
    """Return the sniffed MIME type, or None if libmagic is not available."""
    if not _MAGIC_AVAILABLE:
        return None
    if not data:
        return None
    try:
        return magic.from_buffer(data[:8192], mime=True)
    except Exception:  # pragma: no cover - libmagic edge cases
        logger.exception("libmagic failed to sniff buffer")
        return None


def validate_file_content(data: bytes, filename: str) -> tuple[bool, str | None]:
    """Check declared extension matches the sniffed MIME.

    Returns (ok, sniffed_mime). In production, raises RuntimeError if libmagic is
    missing — silently passing every upload was the original E-7 bypass. In dev
    we return (True, None) so Windows workstations without libmagic still work.
    """
    _ensure_libmagic_in_prod()

    ext = Path(filename or "").suffix.lower()
    if not ext:
        return True, None

    allowed = ALLOWED_MIME_BY_EXT.get(ext)
    if allowed is None:
        # Unknown extension — caller decides whether to reject by extension separately.
        return True, None

    sniffed = detect_mime(data)
    if sniffed is None:
        return True, None

    return sniffed in allowed, sniffed
