"""
File Upload Endpoints
Handle logo, favicon, and other file uploads for system branding
"""
import logging
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image

from src.api.deps import require_admin
from src.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/upload", tags=["upload"])

# Upload directory configuration
UPLOAD_DIR = Path("uploads")
ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".svg", ".ico", ".gif", ".webp"}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB

def _ensure_dir(path: Path) -> None:
    """Ensure a directory exists.

    On this Docker bind-mount setup we've seen mkdir(exist_ok=True) raise
    PermissionError even when the target directory already exists and is
    writable by the runtime UID. Re-checking the path lets startup proceed
    in that case while still failing closed for a genuinely missing dir.
    """
    try:
        path.mkdir(exist_ok=True)
    except PermissionError:
        if not path.is_dir():
            raise


# Ensure upload directories exist
_ensure_dir(UPLOAD_DIR)
_ensure_dir(UPLOAD_DIR / "logos")
_ensure_dir(UPLOAD_DIR / "favicons")


def validate_image_file(file: UploadFile) -> None:
    """Validate uploaded image file"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format. Allowed: {', '.join(ALLOWED_IMAGE_EXTENSIONS)}",
        )

    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {MAX_FILE_SIZE / 1024 / 1024}MB",
        )


def pad_image_to_square(image: Image.Image) -> Image.Image:
    """Pad image to square dimensions by adding transparent/white background"""
    width, height = image.size

    if width == height:
        return image

    square_size = max(width, height)

    if image.mode in ("RGBA", "LA", "PA"):
        new_image = Image.new("RGBA", (square_size, square_size), (255, 255, 255, 0))
    else:
        new_image = Image.new("RGB", (square_size, square_size), (255, 255, 255))

    paste_x = (square_size - width) // 2
    paste_y = (square_size - height) // 2

    if image.mode in ("RGBA", "LA", "PA"):
        new_image.paste(image, (paste_x, paste_y), image)
    else:
        new_image.paste(image, (paste_x, paste_y))

    return new_image


def save_upload_file(file: UploadFile, subfolder: str) -> str:
    """Save uploaded file and return relative URL"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    file_ext = Path(file.filename).suffix.lower()
    unique_filename = f"{uuid.uuid4().hex}{file_ext}"
    upload_path = UPLOAD_DIR / subfolder / unique_filename

    try:
        with open(upload_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    finally:
        file.file.close()

    return f"/uploads/{subfolder}/{unique_filename}"


def save_logo_file(file: UploadFile, subfolder: str) -> str:
    """Save logo file with padding to make it square"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    file_ext = Path(file.filename).suffix.lower()
    unique_filename = f"{uuid.uuid4().hex}{file_ext}"
    upload_path = UPLOAD_DIR / subfolder / unique_filename

    try:
        image = Image.open(file.file)
        square_image = pad_image_to_square(image)

        save_format = image.format or file_ext.lstrip(".").upper()
        if save_format == "JPG":
            save_format = "JPEG"

        if save_format in ["JPEG", "JPG"]:
            if square_image.mode in ("RGBA", "LA", "PA"):
                rgb_image = Image.new("RGB", square_image.size, (255, 255, 255))
                rgb_image.paste(
                    square_image,
                    mask=square_image.split()[-1] if len(square_image.split()) > 3 else None,
                )
                square_image = rgb_image
            square_image.save(upload_path, format=save_format, quality=95)
        else:
            square_image.save(upload_path, format=save_format)

    finally:
        file.file.close()

    return f"/uploads/{subfolder}/{unique_filename}"


@router.post("/logo")
async def upload_logo(
    file: UploadFile = File(...),
    admin: User = Depends(require_admin),
) -> dict:
    """
    Upload logo image (admin only)
    Returns relative URL. Frontend will build full URL with API base.
    """
    try:
        validate_image_file(file)
        relative_url = save_logo_file(file, "logos")

        logger.info(f"Logo uploaded by user {admin.email}: {relative_url}")

        return {
            "success": True,
            "message": "Logo uploaded successfully",
            "data": {
                "url": relative_url,
                "filename": file.filename,
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading logo: {e}")
        raise HTTPException(status_code=500, detail=f"Upload error: {str(e)}")


@router.post("/favicon")
async def upload_favicon(
    file: UploadFile = File(...),
    admin: User = Depends(require_admin),
) -> dict:
    """
    Upload favicon image (admin only)
    Returns relative URL. Frontend will build full URL with API base.
    """
    try:
        validate_image_file(file)
        relative_url = save_upload_file(file, "favicons")

        logger.info(f"Favicon uploaded by user {admin.email}: {relative_url}")

        return {
            "success": True,
            "message": "Favicon uploaded successfully",
            "data": {
                "url": relative_url,
                "filename": file.filename,
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading favicon: {e}")
        raise HTTPException(status_code=500, detail=f"Upload error: {str(e)}")


@router.delete("/file")
async def delete_uploaded_file(
    file_path: str,
    admin: User = Depends(require_admin),
) -> dict:
    """Delete uploaded file (admin only)"""
    try:
        if not file_path.startswith("/uploads/"):
            raise HTTPException(status_code=400, detail="Invalid file path")

        relative_path = file_path.lstrip("/")
        full_path = Path(relative_path)

        if not full_path.exists():
            raise HTTPException(status_code=404, detail="File not found")

        full_path.unlink()

        logger.info(f"File deleted by user {admin.email}: {file_path}")

        return {
            "success": True,
            "message": "File deleted successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting file: {e}")
        raise HTTPException(status_code=500, detail=f"Delete error: {str(e)}")
