"""Shim (P8 W3): google_drive → src/domain/storage/google_drive.py."""
from src.domain.storage.google_drive import GoogleDriveService, _parse_drive_url  # noqa: F401

__all__ = ["GoogleDriveService", "_parse_drive_url"]
