import asyncio
import mimetypes
import re
import tempfile
import urllib.parse
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import BadRequestError, ForbiddenError, NotFoundError
from src.models.user import User
from src.repositories.document import DocumentRepository, FolderRepository, StorageConfigRepository
from src.repositories.integration import GoogleDriveImportRepository
from src.schemas.document import GoogleDriveImportResponse
from src.services.storage import get_storage_backend


# Regex patterns for Google Drive URLs
_FILE_PATTERNS = [
    re.compile(r"drive\.google\.com/file/d/([a-zA-Z0-9_-]+)"),
    re.compile(r"drive\.google\.com/open\?id=([a-zA-Z0-9_-]+)"),
    re.compile(r"docs\.google\.com/\w+/d/([a-zA-Z0-9_-]+)"),
]
_FOLDER_PATTERN = re.compile(r"drive\.google\.com/drive/folders/([a-zA-Z0-9_-]+)")


def _get_gdrive_filename(drive_id: str, fmt: str | None) -> str | None:
    """Fetch the real filename from Google Drive Content-Disposition without downloading."""
    import requests

    if fmt == "xlsx":
        url = f"https://docs.google.com/spreadsheets/d/{drive_id}/export?format=xlsx"
    elif fmt == "docx":
        url = f"https://docs.google.com/document/d/{drive_id}/export?format=docx"
    elif fmt == "pptx":
        url = f"https://docs.google.com/presentation/d/{drive_id}/export/pptx"
    else:
        url = f"https://drive.google.com/uc?id={drive_id}&export=download"

    try:
        with requests.get(url, allow_redirects=True, timeout=10, stream=True) as resp:
            cd = resp.headers.get("Content-Disposition", "")
        m = re.search(r"filename\*=UTF-8''([^;\s]+)", cd, re.IGNORECASE)
        if m:
            return urllib.parse.unquote(m.group(1).strip('"'))
        m = re.search(r'filename="([^"]+)"', cd, re.IGNORECASE)
        if m:
            return m.group(1)
    except Exception:
        pass
    return None


def _parse_drive_url(url: str) -> tuple[str, Literal["file", "folder"]]:
    """Extract ID and type from a Google Drive URL."""
    match = _FOLDER_PATTERN.search(url)
    if match:
        return match.group(1), "folder"

    for pattern in _FILE_PATTERNS:
        match = pattern.search(url)
        if match:
            return match.group(1), "file"

    raise BadRequestError("Invalid Google Drive URL")


class GoogleDriveService:
    def __init__(self, session: AsyncSession) -> None:
        self.import_repo = GoogleDriveImportRepository(session)
        self.doc_repo = DocumentRepository(session)
        self.folder_repo = FolderRepository(session)
        self.storage_config_repo = StorageConfigRepository(session)

    async def import_from_url(
        self, url: str, folder_id: uuid.UUID | None, user: User
    ) -> list[GoogleDriveImportResponse]:
        if folder_id:
            folder = await self.folder_repo.get_by_id_active(folder_id)
            if not folder:
                raise NotFoundError("Folder not found")
            if folder.owner_id != user.id:
                raise ForbiddenError()

        storage_config = await self.storage_config_repo.get_default()
        if not storage_config:
            raise BadRequestError("No default storage config. Ask admin to configure one.")

        drive_id, drive_type = _parse_drive_url(url)

        if drive_type == "file":
            result = await self._import_single_file(
                drive_id=drive_id,
                drive_url=url,
                folder_id=folder_id,
                user=user,
                storage_config=storage_config,
            )
            return [result]
        else:
            return await self._import_folder(
                folder_drive_id=drive_id,
                drive_url=url,
                parent_folder_id=folder_id,
                user=user,
                storage_config=storage_config,
            )

    async def _import_single_file(
        self,
        drive_id: str,
        drive_url: str,
        folder_id: uuid.UUID | None,
        user: User,
        storage_config,
    ) -> GoogleDriveImportResponse:
        import gdown

        # Create import record
        import_record = await self.import_repo.create({
            "user_id": user.id,
            "drive_file_id": drive_id,
            "drive_file_name": "",  # will update after download
            "drive_url": drive_url,
            "mime_type": "",
            "status": "importing",
        })

        try:
            # Download to temp file
            with tempfile.TemporaryDirectory() as tmpdir:
                # Detect Google Docs type to set export format and avoid gdown .part conflict
                if "docs.google.com/document" in drive_url:
                    ext = ".docx"
                    mime_hint = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    fmt: str | None = "docx"
                elif "docs.google.com/spreadsheets" in drive_url:
                    ext = ".xlsx"
                    mime_hint = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    fmt = "xlsx"
                elif "docs.google.com/presentation" in drive_url:
                    ext = ".pptx"
                    mime_hint = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    fmt = "pptx"
                else:
                    ext = ""
                    mime_hint = None
                    fmt = None

                # Download to a deterministic path to avoid gdown's .part temp-file bug.
                output_path = str(Path(tmpdir) / f"{drive_id}{ext}")
                kwargs = {"format": fmt} if fmt else {}

                # Fetch the real filename (e.g. "Vận hành MARKETING 2025.xlsx") from
                # Content-Disposition before the full download — lightweight streaming GET.
                real_name = await asyncio.to_thread(_get_gdrive_filename, drive_id, fmt)
                if real_name:
                    stem = Path(real_name).stem
                    original_filename = f"{stem}{ext}" if ext else real_name
                else:
                    original_filename = f"{drive_id}{ext}"

                output = await asyncio.to_thread(
                    gdown.download,
                    url=drive_url,
                    output=output_path,
                    quiet=True,
                    fuzzy=True,
                    **kwargs,
                )

                if output is None:
                    raise BadRequestError("Failed to download file from Google Drive. Check if the link is public.")

                downloaded_path = Path(output)
                data = await asyncio.to_thread(downloaded_path.read_bytes)

            # Save to storage
            backend = get_storage_backend(storage_config)
            storage_result = await backend.save(data, original_filename)

            mime_type = mime_hint or mimetypes.guess_type(original_filename)[0] or "application/octet-stream"
            extension = downloaded_path.suffix.lower()

            # Create document
            doc = await self.doc_repo.create({
                "title": downloaded_path.stem,
                "file_name": storage_result.file_name,
                "original_filename": original_filename,
                "file_path": storage_result.file_path,
                "file_size": storage_result.file_size,
                "mime_type": mime_type,
                "extension": extension,
                "checksum": storage_result.checksum,
                "folder_id": folder_id,
                "storage_config_id": storage_config.id,
                "owner_id": user.id,
                "source_type": "google_drive",
                "source_metadata": {"drive_file_id": drive_id, "drive_url": drive_url},
            })

            # Update import record
            import_record.drive_file_name = original_filename
            import_record.mime_type = mime_type
            import_record.status = "done"
            import_record.document_id = doc.id
            import_record.completed_at = datetime.now(UTC)

            return GoogleDriveImportResponse.model_validate(import_record)

        except BadRequestError:
            raise
        except Exception as e:
            import_record.status = "failed"
            import_record.error_message = str(e)
            import_record.completed_at = datetime.now(UTC)
            return GoogleDriveImportResponse.model_validate(import_record)

    async def _import_folder(
        self,
        folder_drive_id: str,
        drive_url: str,
        parent_folder_id: uuid.UUID | None,
        user: User,
        storage_config,
    ) -> list[GoogleDriveImportResponse]:
        import gdown

        # List files in the Google Drive folder
        try:
            url = f"https://drive.google.com/drive/folders/{folder_drive_id}"
            file_list = await asyncio.to_thread(gdown.download_folder, url=url, skip_download=True, quiet=True)
        except Exception as e:
            raise BadRequestError(f"Failed to list Google Drive folder: {e}")

        if not file_list:
            raise BadRequestError("Google Drive folder is empty or not accessible")

        # Determine parent path for new folders
        parent_path = ""
        if parent_folder_id:
            parent = await self.folder_repo.get_by_id_active(parent_folder_id)
            if parent:
                parent_path = parent.path

        # Download each file
        results = []
        with tempfile.TemporaryDirectory() as tmpdir:
            # Download entire folder
            try:
                await asyncio.to_thread(
                    gdown.download_folder,
                    url=url,
                    output=tmpdir,
                    quiet=True,
                )
            except Exception as e:
                raise BadRequestError(f"Failed to download Google Drive folder: {e}")

            # Walk the downloaded directory and create folder structure + documents
            tmpdir_path = Path(tmpdir)
            backend = get_storage_backend(storage_config)
            folder_cache: dict[str, uuid.UUID] = {}

            for file_path in sorted(tmpdir_path.rglob("*")):
                if not file_path.is_file():
                    continue

                # Build relative path from tmpdir
                rel_path = file_path.relative_to(tmpdir_path)
                dir_parts = rel_path.parts[:-1]

                # Create folder hierarchy
                current_parent_id = parent_folder_id
                current_parent_path = parent_path
                for i, part in enumerate(dir_parts):
                    cache_key = "/".join(dir_parts[: i + 1])
                    if cache_key in folder_cache:
                        folder = await self.folder_repo.get_by_id_active(folder_cache[cache_key])
                        current_parent_id = folder.id
                        current_parent_path = folder.path
                        continue

                    folder = await self.folder_repo.get_or_create(
                        name=part,
                        parent_id=current_parent_id,
                        owner_id=user.id,
                        path="",
                    )
                    if not folder.path:
                        folder.path = f"{current_parent_path}/{folder.id}"
                    folder_cache[cache_key] = folder.id
                    current_parent_id = folder.id
                    current_parent_path = folder.path

                # Upload file
                original_filename = file_path.name
                data = await asyncio.to_thread(file_path.read_bytes)
                storage_result = await backend.save(data, original_filename)
                mime_type = mimetypes.guess_type(original_filename)[0] or "application/octet-stream"
                extension = file_path.suffix.lower()

                doc = await self.doc_repo.create({
                    "title": file_path.stem,
                    "file_name": storage_result.file_name,
                    "original_filename": original_filename,
                    "file_path": storage_result.file_path,
                    "file_size": storage_result.file_size,
                    "mime_type": mime_type,
                    "extension": extension,
                    "checksum": storage_result.checksum,
                    "folder_id": current_parent_id,
                    "storage_config_id": storage_config.id,
                    "owner_id": user.id,
                    "source_type": "google_drive",
                    "source_metadata": {"drive_folder_id": folder_drive_id, "drive_url": drive_url},
                })

                import_record = await self.import_repo.create({
                    "user_id": user.id,
                    "drive_file_id": folder_drive_id,
                    "drive_file_name": original_filename,
                    "drive_url": drive_url,
                    "mime_type": mime_type,
                    "status": "done",
                    "document_id": doc.id,
                    "completed_at": datetime.now(UTC),
                })
                results.append(GoogleDriveImportResponse.model_validate(import_record))

        return results

    async def list_imports(self, user: User) -> list[GoogleDriveImportResponse]:
        imports = await self.import_repo.get_by_user(user.id)
        return [GoogleDriveImportResponse.model_validate(i) for i in imports]

    async def get_import(self, import_id: uuid.UUID, user: User) -> GoogleDriveImportResponse:
        record = await self.import_repo.get_by_id(import_id)
        if not record:
            raise NotFoundError("Import not found")
        if record.user_id != user.id:
            raise ForbiddenError()
        return GoogleDriveImportResponse.model_validate(record)
