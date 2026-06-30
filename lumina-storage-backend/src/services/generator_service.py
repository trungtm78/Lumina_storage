"""Service bọc GeneratorSession + GeneratorSessionVersion repository.

Phase 6: route KHÔNG truy cập repository trực tiếp → đi qua service này. Mỗi method
delegate 1-1 sang repo tương ứng; KHÔNG commit (boundary ở get_db). Business-logic nặng
(patch DOCX, sinh PDF, AI-revise) vẫn ở route — Phase 8 trích dần (A3: execute_generate).
"""
import json
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
from src.schemas.generator import BlockEditOp
from src.services.generator_docx import (
    _iter_all_paragraphs,
    _merge_runs,
    _replace_in_runs,
    _validate_field_values,
)
from src.services.storage import get_storage_backend

# System prompt cho AI-revise block-based (LLM chỉ thao tác TEXT theo block-id).
_AI_REVISE_SYSTEM = (
    "Bạn là biên tập viên văn bản kinh doanh tiếng Việt. Bạn nhận một tài liệu đã "
    "được tách thành các block, mỗi block có id và nội dung text. Hãy thực hiện các "
    "yêu cầu chỉnh sửa bằng cách trả về DANH SÁCH THAO TÁC dạng JSON.\n"
    "QUY TẮC BẮT BUỘC:\n"
    "1. Chỉ trả JSON đúng schema, KHÔNG giải thích, KHÔNG markdown.\n"
    "2. Mỗi thao tác là một trong: \n"
    '   - {"op":"replace","block_id":"<id>","new_text":"<nội dung mới>"}\n'
    '   - {"op":"insert_after","block_id":"<id>","kind":"paragraph|heading|list_item","text":"<nội dung>"}\n'
    '   - {"op":"delete","block_id":"<id>"}\n'
    "3. block_id PHẢI là id có thật trong danh sách block được cung cấp.\n"
    "4. TUYỆT ĐỐI không chèn thẻ HTML vào new_text/text — chỉ text thuần.\n"
    "5. GIỮ NGUYÊN các token dạng {ten_token} nếu có trong block, không xoá/đổi tên chúng.\n"
    "6. Chỉ tạo thao tác cho những block thực sự cần đổi; block không liên quan thì bỏ qua.\n"
    'Định dạng trả về: {"ops":[ ... ]}'
)


def _strip_json_fence(raw: str) -> str:
    s = (raw or "").strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1] if "\n" in s else s[3:]
        if s.endswith("```"):
            s = s[: -3]
    return s.strip()


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

    async def propose_ops(
        self, text_map: dict[str, str], instructions: list[str]
    ) -> tuple[list[BlockEditOp], list[str]]:
        """Gọi LLM → danh sách op đã validate. Trả (ops, warnings)."""
        from src.ai import AIGateway

        warnings: list[str] = []
        blocks_lines = "\n".join(f"[{bid}] {txt}" for bid, txt in text_map.items())
        instr_lines = "\n".join(f"- {i}" for i in instructions if i.strip()) or "- (không có)"
        user_prompt = (
            f"Danh sách block (id và nội dung):\n{blocks_lines}\n\n"
            f"Yêu cầu chỉnh sửa:\n{instr_lines}\n\n"
            'Trả về JSON {"ops":[...]} theo đúng quy tắc.'
        )
        messages = [
            {"role": "system", "content": _AI_REVISE_SYSTEM},
            {"role": "user", "content": user_prompt},
        ]
        gw = AIGateway(self._session)

        raw = ""
        for attempt in range(2):
            try:
                resp = await gw.complete(
                    messages, response_format={"type": "json_object"}
                )
                raw = resp.choices[0].message.content or ""
                data = json.loads(_strip_json_fence(raw))
                raw_ops = data.get("ops", data) if isinstance(data, dict) else data
                if not isinstance(raw_ops, list):
                    raise ValueError("ops không phải list")
                ops: list[BlockEditOp] = []
                for item in raw_ops:
                    try:
                        ops.append(BlockEditOp.model_validate(item))
                    except Exception:
                        warnings.append("Bỏ qua một thao tác sai định dạng từ AI.")
                return ops, warnings
            except (json.JSONDecodeError, ValueError):
                if attempt == 0:
                    messages.append({"role": "assistant", "content": raw})
                    messages.append({
                        "role": "user",
                        "content": 'Phản hồi trước không phải JSON hợp lệ. Trả lại CHỈ JSON {"ops":[...]}.',
                    })
                    continue
                raise HTTPException(422, "AI không trả về kết quả hợp lệ. Vui lòng thử lại.")
        return [], warnings

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
