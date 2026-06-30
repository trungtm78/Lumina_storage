"""Service bọc GeneratorSession + GeneratorSessionVersion repository.

Phase 6: route KHÔNG truy cập repository trực tiếp → đi qua service này. Mỗi method
delegate 1-1 sang repo tương ứng; KHÔNG commit (boundary ở get_db). Business-logic nặng
(patch DOCX, sinh PDF, AI-revise) vẫn ở route — Phase 8 trích dần (A3: execute_generate).
"""
import uuid
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.document import Document
from src.models.generator import GeneratorSession, GeneratorSessionVersion
from src.repositories.generator import (
    GeneratorSessionRepository,
    GeneratorSessionVersionRepository,
)
from src.services.generator_docx import (
    _iter_all_paragraphs,
    _merge_runs,
    _replace_in_runs,
    _validate_field_values,
)
from src.services.storage import get_storage_backend


class GeneratorService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._sessions = GeneratorSessionRepository(session)
        self._versions = GeneratorSessionVersionRepository(session)

    # ── Generation (business-logic) ──────────────────────────────────────────
    async def execute_generate(
        self,
        template_id: uuid.UUID,
        field_values: dict[str, str],
        output_filename: str | None,
        folder_id: uuid.UUID | None,
        owner_id: uuid.UUID,
        skip_field_validation: bool = False,
    ) -> tuple[Document, str, int]:
        """Core generation logic shared by /generate and /sessions/{id}/generate.

        Returns (rendered_document, out_filename, applied_count).
        Does NOT commit — caller is responsible.
        """
        from docx import Document as DocxDocument

        from src.models.storage import StorageConfig

        db = self._session
        template_doc = await db.get(Document, template_id)
        if not template_doc or template_doc.source_type != "template" or template_doc.deleted_at is not None:
            raise HTTPException(404, "Template not found")

        template_meta = template_doc.source_metadata or {}
        template_fields = template_meta.get("template_fields") or []
        if not skip_field_validation:
            issues = _validate_field_values(template_fields, field_values)
            if issues:
                raise HTTPException(status_code=422, detail={"issues": issues})

        storage_cfg = await db.get(StorageConfig, template_doc.storage_config_id)
        if not storage_cfg:
            raise HTTPException(500, "Storage config not found")

        backend = get_storage_backend(storage_cfg)
        doc_bytes = await backend.read(template_doc.file_path)

        docx = DocxDocument(BytesIO(doc_bytes))
        applied_count = 0
        for para in _iter_all_paragraphs(docx):
            if not para.runs:
                continue
            for key, value in field_values.items():
                token = "{" + key + "}"
                # Thay token ở mức RUN để GIỮ format (đậm/nghiêng/font) — không flatten đoạn.
                if _replace_in_runs(para, token, value):
                    applied_count += 1
                elif token in para.text:
                    # Token bị Word tách qua nhiều run → merge rồi thay (chỉ khi cần)
                    _merge_runs(para)
                    if token in para.runs[0].text:
                        para.runs[0].text = para.runs[0].text.replace(token, value)
                        applied_count += 1

        output = BytesIO()
        docx.save(output)
        rendered_bytes = output.getvalue()

        src_path = Path(template_doc.original_filename)
        out_filename = output_filename or f"{src_path.stem}_generated{src_path.suffix}"

        save_result = await backend.save(rendered_bytes, out_filename)
        rendered_doc = Document(
            title=output_filename or f"{template_doc.title} (generated)",
            file_name=save_result.file_name,
            original_filename=out_filename,
            file_path=save_result.file_path,
            file_size=save_result.file_size,
            mime_type=template_doc.mime_type,
            extension=src_path.suffix.lstrip("."),
            checksum=save_result.checksum,
            storage_config_id=template_doc.storage_config_id,
            owner_id=owner_id,
            folder_id=folder_id,
            source_type="generated",
            source_metadata={
                "template_id": str(template_id),
                "field_values": field_values,
                "applied_count": applied_count,
            },
        )
        db.add(rendered_doc)
        await db.flush()
        await db.refresh(rendered_doc)
        return rendered_doc, out_filename, applied_count

    # ── Session ──────────────────────────────────────────────────────────────
    async def create_session(self, data: dict) -> GeneratorSession:
        return await self._sessions.create(data)

    async def get_session_for_user(
        self, session_id: uuid.UUID, user_id: uuid.UUID
    ) -> GeneratorSession | None:
        return await self._sessions.get_by_id_for_user(session_id, user_id)

    async def update_session(
        self, session_id: uuid.UUID, data: dict
    ) -> GeneratorSession | None:
        return await self._sessions.update(session_id, data)

    async def delete_session(self, session_id: uuid.UUID) -> bool:
        return await self._sessions.delete(session_id)

    async def list_sessions_for_user(
        self,
        user_id: uuid.UUID,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[GeneratorSession], int]:
        return await self._sessions.list_for_user(
            user_id=user_id, status=status, limit=limit, offset=offset
        )

    async def count_drafts_by_template(self, template_id: uuid.UUID) -> int:
        return await self._sessions.count_draft_by_template(template_id)

    # ── Version ──────────────────────────────────────────────────────────────
    async def next_version_no(self, session_id: uuid.UUID) -> int:
        return await self._versions.next_version_no(session_id)

    async def create_version(self, data: dict) -> GeneratorSessionVersion:
        return await self._versions.create(data)

    async def get_version_for_session(
        self, version_id: uuid.UUID, session_id: uuid.UUID
    ) -> GeneratorSessionVersion | None:
        return await self._versions.get_by_id_for_session(version_id, session_id)

    async def update_version(
        self, version_id: uuid.UUID, data: dict
    ) -> GeneratorSessionVersion | None:
        return await self._versions.update(version_id, data)

    async def list_versions_for_session(
        self, session_id: uuid.UUID, limit: int = 50, offset: int = 0
    ) -> tuple[list[GeneratorSessionVersion], int]:
        return await self._versions.list_for_session(session_id, limit=limit, offset=offset)

    async def delete_version(self, version_id: uuid.UUID) -> bool:
        return await self._versions.delete(version_id)
