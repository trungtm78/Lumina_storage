"""Ingest real Got It Legal DOCX files, replacing seeded stub templates.

The legal-catalog stubs (created by `seed_legal_catalog.py`) hold placeholder
content. Once the user manually downloads the real DOCX from SharePoint, this
script replaces the storage file + re-extracts placeholders so the same DB
template now points at the real document.

The match key is the catalog's `file_code` — extracted from the DOCX filename
by stripping the trailing `.docx` (the user is expected to keep the original
catalog filename, e.g. `01 - SAL_HOP DONG NGUYEN TAC_VIE.docx`).

Run:
    python scripts/ingest_legal_real_docx.py path/to/file1.docx path/to/file2.docx
    python scripts/ingest_legal_real_docx.py path/to/folder/                # all .docx in dir
    python scripts/ingest_legal_real_docx.py --dry-run path/to/file.docx    # preview
"""
from __future__ import annotations

import argparse
import asyncio
import io
import sys
import uuid
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from src.core.config import get_settings
from src.models.document import Document
from src.models.storage import StorageConfig
from src.services.legal_docx_converter import convert_docx
from src.services.storage import get_storage_backend

SEED_MARKER_KEY = "legal_catalog_seed"


def _force_utf8_stdout() -> None:
    if hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


def _file_code_from_path(path: Path) -> str:
    """`01 - SAL_HOP DONG NGUYEN TAC_VIE.docx` → `01 - SAL_HOP DONG NGUYEN TAC_VIE`."""
    stem = path.stem
    return stem.strip()


def _expand_paths(inputs: list[Path]) -> list[Path]:
    out: list[Path] = []
    for p in inputs:
        if p.is_dir():
            out.extend(sorted(p.glob("*.docx")))
        elif p.suffix.lower() == ".docx" and p.is_file():
            out.append(p)
    return out


def _build_template_fields_from_placeholders(
    placeholders: list[str],
    existing_fields: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Convert detected placeholder names into the v2 `template_fields` shape.

    Preserves any matching pre-existing field (label, type, section_key,
    required) so manual edits in the UI survive a re-ingest of the same file.
    Fields no longer present in the DOCX are dropped.
    """
    by_placeholder = {
        f["placeholder"]: f for f in (existing_fields or [])
    }
    out: list[dict[str, Any]] = []
    for idx, slug in enumerate(placeholders):
        old = by_placeholder.get(slug, {})
        # Reasonable defaults:
        # - `ngay_*` → date type, required
        # - `so_*` → text, required
        # - everything else → blank text
        if slug.startswith("ngay"):
            default_type, default_required = "date", True
        elif slug.startswith(("so_", "ma_")):
            default_type, default_required = "blank", True
        else:
            default_type, default_required = "blank", None

        out.append(
            {
                "id": f"f{idx}",
                "placeholder": slug,
                "label": old.get("label") or slug.replace("_", " ").title(),
                "description": old.get("description", ""),
                "location": old.get("location", f"para_{idx}"),
                "type": old.get("type") or default_type,
                "options": old.get("options"),
                "section_key": old.get("section_key"),
                "required": (
                    old["required"]
                    if "required" in old and old["required"] is not None
                    else default_required
                ),
            }
        )
    return out


async def _find_stub_by_file_code(
    db: AsyncSession, file_code: str,
) -> Document | None:
    """Look up the legal-catalog template by its catalog `file_code`.

    The seed marker is intentionally NOT in the WHERE clause: a previously
    ingested template has the marker dropped, but should still match if the
    user re-downloads a corrected DOCX and re-runs the ingest.
    """
    stmt = select(Document).where(
        Document.source_type == "template",
        Document.deleted_at.is_(None),
        Document.source_metadata["legal_catalog"]["file_code"].astext == file_code,
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def main(paths: list[Path], dry_run: bool) -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, echo=False)
    Session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    docx_paths = _expand_paths(paths)
    if not docx_paths:
        raise SystemExit("Không tìm thấy file .docx hợp lệ.")

    print(f"Sẽ xử lý {len(docx_paths)} file:")
    for p in docx_paths:
        print(f"  - {p.name}")
    print()

    successes = 0
    skipped: list[tuple[str, str]] = []  # (filename, reason)

    async with Session() as db:
        for path in docx_paths:
            file_code = _file_code_from_path(path)
            stub = await _find_stub_by_file_code(db, file_code)

            if not stub:
                skipped.append((path.name, f"Không match stub nào (file_code={file_code!r})"))
                continue

            # Convert DOCX placeholders.
            try:
                conv = convert_docx(path.read_bytes())
            except Exception as exc:
                skipped.append((path.name, f"Convert lỗi: {exc}"))
                continue

            print(f"\n[{path.name}]")
            print(f"  → stub id: {stub.id}")
            print(f"  → title:   {stub.title}")
            print(f"  → placeholders found: {len(conv.placeholders)}")
            for ph in conv.placeholders:
                print(f"      {ph}")

            if dry_run:
                continue

            # Replace storage backing file.
            storage_cfg = await db.get(StorageConfig, stub.storage_config_id)
            if not storage_cfg:
                skipped.append((path.name, "Stub thiếu storage_config — bỏ qua"))
                continue
            backend = get_storage_backend(storage_cfg)
            old_file_path = stub.file_path

            new_filename = path.name
            save_result = await backend.save(conv.docx_bytes, new_filename)
            stub.file_path = save_result.file_path
            stub.file_name = save_result.file_name
            stub.file_size = save_result.file_size
            stub.checksum = save_result.checksum
            stub.original_filename = new_filename

            # Best-effort: clean up the now-orphaned stub file.
            if old_file_path and old_file_path != save_result.file_path:
                try:
                    await backend.delete(old_file_path)
                except Exception as exc:
                    print(f"  warn: không xoá được file cũ {old_file_path}: {exc}")

            # Rebuild template_fields from new placeholders (preserve manual edits).
            meta = dict(stub.source_metadata or {})
            old_fields = meta.get("template_fields") or []
            meta["template_fields"] = _build_template_fields_from_placeholders(
                conv.placeholders, old_fields,
            )
            meta["extraction_status"] = "completed"
            # Drop the seed marker flag — this template is no longer a stub.
            meta.pop(SEED_MARKER_KEY, None)
            stub.source_metadata = meta

            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(stub, "source_metadata")

            successes += 1

        if not dry_run:
            await db.commit()

    print()
    print(f"Done. Đã update {successes}/{len(docx_paths)} file.")
    if skipped:
        print("\nSkipped:")
        for name, reason in skipped:
            print(f"  - {name}: {reason}")
    if dry_run:
        print("\n(dry-run — không có thay đổi nào được ghi vào DB.)")

    await engine.dispose()


if __name__ == "__main__":
    _force_utf8_stdout()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", type=Path, nargs="+", help="DOCX file(s) hoặc folder.")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Chỉ preview placeholders, không ghi DB.",
    )
    args = parser.parse_args()
    asyncio.run(main(args.paths, dry_run=args.dry_run))
