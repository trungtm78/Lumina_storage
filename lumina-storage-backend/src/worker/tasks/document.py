import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import get_settings
from src.core.uow import uow_context
from src.models.document import Document, DocumentChunk, DocumentContent
from src.models.processing import BackgroundTask
from src.repositories.document import StorageConfigRepository
from src.services.embedding_service import EmbeddingService
from src.services.storage import get_storage_backend
from src.services.template_service import extract_template, extract_template_draft
from src.services.text_extraction_service import TextExtractionService
from src.services.vector_service import ChunkPoint, VectorService

logger = logging.getLogger(__name__)


class _IngestFailed(Exception):
    """Lỗi nghiệp vụ TERMINAL (vd document not found) — mark failure nhưng KHÔNG raise lại
    (tránh arq retry vô ích). Khác lỗi hệ thống (extraction/DB) vốn raise để arq retry."""


class _IngestSkip(Exception):
    """Kết thúc THÀNH CÔNG sớm (vd document không có page) — mark success(skipped)."""

    def __init__(self, result: dict) -> None:
        super().__init__("ingest skipped")
        self.result = result


async def mark_ingest_status(session_factory, task_id: uuid.UUID, status: str, **fields) -> None:
    """Phase 3 T5 — checkpoint status ở SESSION RIÊNG (độc lập transaction business).

    Mở session ngắn, cập nhật BackgroundTask.status + fields (started_at/completed_at/
    result/error_message) rồi commit. PHẢI tách khỏi session business để: status='failure'
    SỐNG qua business rollback, và status='success' chỉ ghi SAU khi business commit. No-op
    nếu task không tồn tại.
    """
    async with session_factory() as s:
        bg = await s.get(BackgroundTask, task_id)
        if bg is None:
            return
        bg.status = status
        # Phase 3 T5: dọn field đối lập để ARQ retry không để lại trạng thái mâu thuẫn
        # (vd success kèm error_message cũ). fields truyền vào sẽ ghi đè bên dưới.
        if status in ("running", "success"):
            bg.error_message = None
        if status != "success":
            bg.result = None
        for key, value in fields.items():
            setattr(bg, key, value)
        # Phase 3 T5: commit checkpoint ở session riêng (độc lập business).
        await s.commit()


async def mark_extract_status(
    session_factory,
    task_id: uuid.UUID,
    document_id: uuid.UUID,
    status: str,
    doc_extraction_status: str,
    *,
    error_message: str | None = None,
) -> None:
    """Phase 3 T5 — checkpoint KÉP ở SESSION RIÊNG cho extract_template*: cập nhật cả
    BackgroundTask.status LẪN source document.source_metadata['extraction_status'] (FE poll
    cái sau để dừng spinner). Phải sống qua business rollback (vd extract lỗi giữa chừng).
    """
    from sqlalchemy.orm.attributes import flag_modified

    async with session_factory() as s:
        bg = await s.get(BackgroundTask, task_id)
        if bg is not None:
            bg.status = status
            bg.completed_at = datetime.now(timezone.utc)
            if error_message is not None:
                bg.error_message = error_message
        doc = await s.get(Document, document_id)
        if doc is not None:
            meta = dict(doc.source_metadata or {})
            meta["extraction_status"] = doc_extraction_status
            if error_message is not None:
                meta["extraction_error"] = error_message
            doc.source_metadata = meta
            flag_modified(doc, "source_metadata")
        # Phase 3 T5: commit checkpoint KÉP ở session riêng (độc lập business).
        await s.commit()


async def cleanup_deleted_document_task(
    ctx: dict,
    document_id: uuid.UUID,
    storage_config_id: uuid.UUID,
    file_path: str,
    image_thumbnail: str | None,
    version_file_paths: list[str],
) -> dict:
    """Xóa storage files của document đã bị hard-delete khỏi DB.
    Qdrant đã được xóa đồng bộ trước khi DB delete.
    Không cần DB session vì document đã xóa rồi.
    """
    settings = get_settings()
    deleted = {"storage_files": [], "errors": []}

    # Xóa files trên storage
    try:
        storage_repo_session = ctx.get("session_factory")
        # Dùng session riêng chỉ để load storage config
        async with storage_repo_session() as db:
            storage_repo = StorageConfigRepository(db)
            config = await storage_repo.get_by_id(storage_config_id)

        if config:
            backend = get_storage_backend(config)
            all_files = [file_path] + ([image_thumbnail] if image_thumbnail else []) + version_file_paths
            for path in all_files:
                try:
                    await backend.delete(path)
                    deleted["storage_files"].append(path)
                except Exception as e:
                    logger.warning("cleanup_deleted_document_task: storage delete failed for %s: %s", path, e)
                    deleted["errors"].append(f"storage:{path}: {e}")
    except Exception as e:
        logger.warning("cleanup_deleted_document_task: storage backend init failed: %s", e)
        deleted["errors"].append(f"storage_init: {e}")

    return deleted


async def ingest_document_task(ctx: dict, task_id: uuid.UUID, document_id: uuid.UUID) -> dict:
    """Phase 3 T5: checkpoint status (running/success/failure) ở SESSION RIÊNG qua
    mark_ingest_status; business DB (DocumentContent + DocumentChunk + document fields)
    trong uow_context (MỘT transaction) — lỗi giữa chừng → rollback DB NHƯNG status='failure'
    vẫn ghi; status='success' chỉ ghi SAU khi business commit.

    LƯU Ý: Qdrant (vector_svc) là side-effect NGOÀI transaction DB — uow_context KHÔNG
    rollback được vector. Pipeline tự đồng bộ lại khi retry (đầu pipeline đã xóa chunk+vector
    cũ rồi upsert lại → idempotent). Blue/green extraction triệt để thuộc Phase 5."""
    session_factory = ctx["session_factory"]
    # Checkpoint running (session riêng, độc lập business).
    await mark_ingest_status(
        session_factory, task_id, "running", started_at=datetime.now(timezone.utc)
    )
    result: dict
    try:
        # Business boundary: uow_context tạo session riêng + commit khi thoát sạch / rollback khi lỗi.
        async with uow_context(session_factory) as uow:
            db = uow.session

            document = await db.get(Document, document_id)
            if document is None:
                raise _IngestFailed("Document not found")

            settings = get_settings()

            embedding_svc: EmbeddingService = await EmbeddingService.from_db_default(db)
            vector_svc: VectorService = VectorService(settings)

            # 3. Read file bytes from storage backend
            storage_repo = StorageConfigRepository(db)
            storage_config = await storage_repo.get_by_id(document.storage_config_id)
            if not storage_config:
                raise RuntimeError(f"Storage config {document.storage_config_id} not found")

            backend = get_storage_backend(storage_config)
            file_bytes = await backend.read(document.file_path)

            # 4. Extract text — separate path for Excel/CSV (RAGFlow style)
            _EXCEL_EXTENSIONS = {".xlsx", ".xls", ".csv"}

            if document.extension in _EXCEL_EXTENSIONS:
                # ── Excel/CSV path ───────────────────────────────────────────
                # Bypass TextExtractionService entirely.
                # excel_rag_service handles: magic byte detection, fallback chain
                # (openpyxl → pandas → calamine), merged cells, multi-level headers,
                # bold hierarchy detection. Returns 1 PageResult per data row.
                from src.services.excel_rag_service import parse_xlsx_to_page_results
                pages = parse_xlsx_to_page_results(file_bytes)
                logger.info(
                    "[extract] Excel/CSV document_id=%s ext=%s → %d row chunk(s) across %d sheet(s)",
                    document_id, document.extension, len(pages),
                    len({p.page_number for p in pages}),
                )
            else:
                # ── Normal path (PDF, PPTX, DOCX, images, ...) ──────────────
                from src.services.ai_model_config_service import get_default_litellm_config

                # Phase 4 T2: dùng purpose 'vlm' (fallback 'chat' nếu admin chưa cấu hình vlm
                # — get_default_litellm_config xử lý no-raise). Cho phép cấu hình model + max_tokens
                # riêng cho VLM (vd multimodal gpt-4o với max_tokens lớn cho trang dày).
                vlm_cfg = await get_default_litellm_config(db, "vlm")
                vlm_model = vlm_cfg.model
                vlm_kwargs: dict = {k: v for k, v in vlm_cfg.to_kwargs().items() if k != "model"}

                extractor = TextExtractionService(
                    gotenberg_url=settings.gotenberg_url,
                    vlm_model=vlm_model,
                    vlm_kwargs=vlm_kwargs,
                )
                pages = await extractor.extract(file_bytes, document.mime_type, document.extension)
                logger.info(
                    "[extract] document_id=%s mime=%s ext=%s → %d page(s)",
                    document_id, document.mime_type, document.extension, len(pages),
                )
                for p in pages:
                    logger.info(
                        "[extract]   page_number=%s  chars=%d\n%s",
                        p.page_number, len(p.text), p.text,
                    )

            if not pages:
                # page_count=0 ghi ở nhánh except _IngestSkip (session riêng) vì raise dưới
                # đây sẽ rollback business — không set trên session business (sẽ mất).
                raise _IngestSkip({"page_count": 0, "chunk_count": 0, "skipped": True})

            # 5. Upsert DocumentContent (raw_text = joined markdown)
            full_markdown = "\n\n".join(p.text for p in pages)
            existing_content = await db.get(DocumentContent, document_id)
            if existing_content:
                existing_content.raw_text = full_markdown
            else:
                db.add(DocumentContent(document_id=document_id, raw_text=full_markdown))
            await db.flush()

            # 6. Populate search_vector for FTS — unaccent so 'nhân viên' matches 'nhan vien'
            await db.execute(
                text(
                    "UPDATE documents_documentcontent "
                    "SET search_vector = to_tsvector('simple', unaccent(raw_text)) "
                    "WHERE document_id = :id"
                ),
                {"id": str(document_id)},
            )

            # 7. Delete old chunks + vectors
            await vector_svc.delete_by_document(document_id)
            await db.execute(
                delete(DocumentChunk).where(DocumentChunk.document_id == document_id)
            )
            await db.flush()

            # 8. Chunking strategy:
            #    - Excel/CSV → already 1 row per PageResult, no splitting needed
            #    - 1 page (txt/md/docx)  → chunk by markdown section
            #    - nhiều page (pdf/pptx) → 1 page = 1 chunk (fallback split nếu page > 24000 chars)
            from langchain_core.documents import Document as LCDocument
            from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter

            final_chunks: list[tuple] = []  # (LangChain doc, page_number)

            if document.extension in _EXCEL_EXTENSIONS:
                # Excel/CSV: each PageResult is already 1 row chunk — use directly, no splitting
                for page in pages:
                    final_chunks.append((LCDocument(page_content=page.text), page.page_number))
                logger.info("[chunking] Excel/CSV → %d row chunk(s) (1 row = 1 chunk)", len(final_chunks))
            elif len(pages) == 1:
                # Single-page document: chunk by section, then sentence-split inside each
                # section so Vietnamese sentence boundaries (?/!/…/abbreviations) are honored.
                from src.services.text_chunking import chunk_by_sentences

                md_splitter = MarkdownHeaderTextSplitter(
                    headers_to_split_on=[("#", "h1"), ("##", "h2"), ("###", "h3")],
                    strip_headers=False,
                )
                header_splits = md_splitter.split_text(pages[0].text)
                section_chunks = []
                for section in header_splits:
                    pieces = chunk_by_sentences(section.page_content, chunk_size=1500, chunk_overlap=150)
                    for piece in pieces:
                        section_chunks.append(LCDocument(page_content=piece, metadata=section.metadata))
                for chunk in section_chunks:
                    final_chunks.append((chunk, pages[0].page_number))
                logger.info("[chunking] single-page → %d section chunk(s) (VN sentence-aware)", len(section_chunks))
            else:
                # Multi-page document: 1 page = 1 chunk
                # XLSX sheets có thể là bảng rất lớn → chunk theo row groups
                import re as _re

                def _split_table_by_rows(text: str, max_chars: int = 12000) -> list[str]:
                    """Split markdown table thành chunks theo char limit, mỗi chunk giữ header."""
                    lines = text.splitlines()
                    header_lines: list[str] = []
                    data_lines: list[str] = []
                    found_separator = False
                    for line in lines:
                        if not found_separator:
                            header_lines.append(line)
                            if _re.match(r"^\|[\s\-:|]+\|", line):
                                found_separator = True
                        else:
                            if line.strip():
                                data_lines.append(line)
                    if not data_lines or not found_separator:
                        return [text]
                    header = "\n".join(header_lines)
                    chunks: list[str] = []
                    current_rows: list[str] = []
                    current_len = len(header)
                    for row in data_lines:
                        if current_rows and current_len + len(row) + 1 > max_chars:
                            chunks.append(header + "\n" + "\n".join(current_rows))
                            current_rows = []
                            current_len = len(header)
                        current_rows.append(row)
                        current_len += len(row) + 1
                    if current_rows:
                        chunks.append(header + "\n" + "\n".join(current_rows))
                    return chunks or [text]

                def _is_table_heavy(text: str) -> bool:
                    """True nếu text chủ yếu là markdown table."""
                    table_lines = sum(1 for line in text.splitlines() if line.startswith("|"))
                    return table_lines > 10 and table_lines / max(len(text.splitlines()), 1) > 0.5

                from src.services.text_chunking import chunk_by_sentences as _vi_chunk

                for page in pages:
                    if len(page.text) <= 24000:
                        final_chunks.append((LCDocument(page_content=page.text), page.page_number))
                        logger.info("[chunking] page_number=%s → 1 chunk (%d chars)", page.page_number, len(page.text))
                    elif _is_table_heavy(page.text):
                        table_chunks = _split_table_by_rows(page.text)
                        for chunk_text in table_chunks:
                            final_chunks.append((LCDocument(page_content=chunk_text), page.page_number))
                        logger.info("[chunking] page_number=%s → %d row-group chunks (table, %d chars)", page.page_number, len(table_chunks), len(page.text))
                    else:
                        # Vietnamese-aware split for long prose pages
                        splits = _vi_chunk(page.text, chunk_size=24000, chunk_overlap=500)
                        for chunk_text in splits:
                            final_chunks.append((LCDocument(page_content=chunk_text), page.page_number))
                        logger.info("[chunking] page_number=%s → %d chunks (VN-aware fallback, %d chars)", page.page_number, len(splits), len(page.text))

            logger.info(
                "[chunking] document_id=%s total=%d chunks, page_number distribution: %s",
                document_id,
                len(final_chunks),
                {pn: sum(1 for _, p in final_chunks if p == pn) for pn in sorted({p for _, p in final_chunks})},
            )

            # 9-11. Insert chunks to DB, embed, upsert to Qdrant — processed in batches
            # to avoid exhausting embedding quota and Qdrant payload limit in one shot.
            _PIPELINE_BATCH = 50

            for batch_start in range(0, len(final_chunks), _PIPELINE_BATCH):
                batch = final_chunks[batch_start : batch_start + _PIPELINE_BATCH]
                batch_end = batch_start + len(batch)
                logger.info(
                    "[pipeline] batch %d-%d / %d chunks",
                    batch_start + 1, batch_end, len(final_chunks),
                )

                # 9. Insert DocumentChunk records for this batch
                chunk_records: list[DocumentChunk] = []
                for idx, (lc_chunk, page_num) in enumerate(batch, start=batch_start):
                    chunk = DocumentChunk(
                        document_id=document_id,
                        chunk_index=idx,
                        content=lc_chunk.page_content,
                        page_number=page_num,
                    )
                    db.add(chunk)
                    chunk_records.append(chunk)
                await db.flush()  # populate chunk IDs

                # 10. Embed this batch
                texts = [c.content for c in chunk_records]
                vectors = await embedding_svc.embed_texts(texts)

                # 11. Upsert this batch to Qdrant
                points: list[ChunkPoint] = []
                for chunk, vector in zip(chunk_records, vectors):
                    point_id = uuid.uuid4()
                    points.append(
                        ChunkPoint(
                            id=point_id,
                            vector=vector,
                            payload={
                                "document_id": str(document_id),
                                "owner_id": str(document.owner_id),
                                "chunk_id": str(chunk.id),
                                "chunk_index": chunk.chunk_index,
                                "page_number": chunk.page_number,
                                "content": chunk.content,
                            },
                        )
                    )
                    chunk.qdrant_point_id = point_id
                await vector_svc.upsert_chunks(points)

            # 12. Update document metadata
            # Excel: page_number = sheet index → count distinct sheets, not rows
            if document.extension in _EXCEL_EXTENSIONS:
                document.page_count = len({p.page_number for p in pages})
            else:
                document.page_count = len(pages)

            # 13. Business xong — set result (status='success' ghi SAU khi uow commit).
            result = {"page_count": len(pages), "chunk_count": len(final_chunks)}
        # uow_context commit business ở đây (thoát async with không lỗi).
    except _IngestSkip as skip:
        # Document không có page → success(skipped). Business đã rollback, nên persist
        # page_count=0 ở SESSION RIÊNG (re-ingest từ N page → 0 page phải reset đúng).
        async with session_factory() as s:
            doc = await s.get(Document, document_id)
            if doc is not None:
                doc.page_count = 0
            await s.commit()
        await mark_ingest_status(
            session_factory, task_id, "success",
            result=skip.result, completed_at=datetime.now(timezone.utc),
        )
        return skip.result
    except _IngestFailed as e:
        # Lỗi nghiệp vụ terminal (document not found) → failure, KHÔNG raise (no arq retry).
        await mark_ingest_status(
            session_factory, task_id, "failure",
            error_message=str(e), completed_at=datetime.now(timezone.utc),
        )
        return {"error": str(e)}
    except Exception as e:
        # Lỗi hệ thống → business ĐÃ rollback (uow_context); ghi failure ở SESSION RIÊNG rồi raise.
        await mark_ingest_status(
            session_factory, task_id, "failure",
            error_message=repr(e), completed_at=datetime.now(timezone.utc),
        )
        raise

    # status='success' chỉ ghi SAU khi business commit (thoát async with không lỗi).
    await mark_ingest_status(
        session_factory, task_id, "success",
        result=result, completed_at=datetime.now(timezone.utc),
    )
    return result


def _build_template_llm_call(db: AsyncSession):
    """Phase 4 T5c: dựng `llm_call` (non-stream, trả content) qua AIGateway cho
    extract_template/draft worker. Dùng CHUNG cho cả 2 task (gỡ trùng lặp).
    `complete()` force stream=False (extraction deterministic); response_format
    forward qua overrides chỉ khi caller truyền."""
    from src.ai import AIGateway

    gw = AIGateway(db)

    async def llm_call(messages, response_format=None):
        overrides = {"response_format": response_format} if response_format else {}
        resp = await gw.complete(messages, **overrides)
        return resp.choices[0].message.content or ""

    return llm_call


async def extract_template_task(
    ctx: dict,
    task_id: uuid.UUID,
    document_id: uuid.UUID,
    user_id: uuid.UUID,
    description: str | None = None,
) -> dict:
    """Background task: extract template from a document.

    Creates a template copy with {placeholder} tokens replacing blank fields.
    """
    session_factory = ctx["session_factory"]
    settings = get_settings()

    async with session_factory() as db:
        db: AsyncSession

        bg_task = await db.get(BackgroundTask, task_id)
        if bg_task:
            bg_task.status = "running"
            bg_task.started_at = datetime.now(timezone.utc)
            bg_task.error_message = None  # dọn stale error từ lần retry trước
            await db.commit()

        document = await db.get(Document, document_id)
        if document is None:
            msg = "Document not found"
            # Phase 3 T5: ghi failure KÉP (bg + doc metadata) — FE poll extraction_status.
            await mark_extract_status(
                session_factory, task_id, document_id, "failure", "failed", error_message=msg,
            )
            return {"error": msg}
        if document.extension.lower() != ".docx":
            msg = (
                f"Template extraction chỉ hỗ trợ file .docx. "
                f"File này có định dạng '{document.extension}' — vui lòng upload file Word."
            )
            logger.warning(
                "Template extraction rejected for document %s (extension=%s)",
                document_id, document.extension,
            )
            # Phase 3 T5: set doc metadata 'failed' để FE polling dừng (không kẹt 'pending').
            await mark_extract_status(
                session_factory, task_id, document_id, "failure", "failed", error_message=msg,
            )
            return {"error": msg}

        # Phase 4 T5c: chat LLM call qua AIGateway (config admin, no env fallback).
        llm_call = _build_template_llm_call(db)

        try:
            result = await extract_template(
                db=db,
                settings=settings,
                document_id=document_id,
                user_id=user_id,
                description=description,
                llm_call=llm_call,
            )

            # extract_template returns {"error": "..."} for expected failures (no fields, etc.)
            if result.get("error"):
                raise ValueError(result["error"])

            logger.info("Template extraction completed: %s", result.get("template_id"))

            # Update source document metadata so polling via original ID works
            document = await db.get(Document, document_id)
            if document is not None:
                from sqlalchemy.orm.attributes import flag_modified
                meta = dict(document.source_metadata or {})
                meta["extraction_status"] = "completed"
                meta["template_id"] = result.get("template_id")
                document.source_metadata = meta
                flag_modified(document, "source_metadata")

            if bg_task:
                bg_task.status = "success"
                bg_task.result = result
                bg_task.error_message = None  # dọn stale error nếu là retry
                bg_task.completed_at = datetime.now(timezone.utc)
            # Phase 3 T5: success commit trên business session (atomic với doc metadata completed).
            await db.commit()

            return result
        except Exception as e:
            logger.exception("Template extraction failed for document %s", document_id)
            # Phase 3 T5: rollback business (template doc dở) RỒI ghi failed ở SESSION RIÊNG
            # (sống qua rollback + qua trường hợp session business bị poison) — FE poll
            # source_metadata.extraction_status='failed' để dừng spinner.
            await db.rollback()
            await mark_extract_status(
                session_factory, task_id, document_id, "failure", "failed", error_message=str(e),
            )
            return {"error": str(e)}


async def extract_template_draft_task(
    ctx: dict,
    task_id: uuid.UUID,
    document_id: uuid.UUID,
) -> dict:
    """Background task: run LLM extraction and store DRAFT result.

    Does NOT create a template Document. Result is stored on the
    BackgroundTask.result so the frontend can poll, review, and edit
    before calling commit_template.
    """
    session_factory = ctx["session_factory"]
    settings = get_settings()

    async with session_factory() as db:
        db: AsyncSession

        bg_task = await db.get(BackgroundTask, task_id)
        if bg_task:
            bg_task.status = "running"
            bg_task.started_at = datetime.now(timezone.utc)
            bg_task.error_message = None  # dọn stale error từ lần retry trước
            await db.commit()

        document = await db.get(Document, document_id)
        if document is None:
            msg = "Document not found"
            await mark_extract_status(
                session_factory, task_id, document_id, "failure", "failed", error_message=msg,
            )
            return {"error": msg}
        if document.extension.lower() != ".docx":
            msg = (
                f"Template extraction chỉ hỗ trợ file .docx. "
                f"File này có định dạng '{document.extension}' — vui lòng upload file Word."
            )
            # Phase 3 T5: set doc metadata 'failed' để FE polling dừng (không kẹt 'pending').
            await mark_extract_status(
                session_factory, task_id, document_id, "failure", "failed", error_message=msg,
            )
            return {"error": msg}

        # Phase 4 T5c: chat LLM call qua AIGateway (config admin, no env fallback).
        llm_call = _build_template_llm_call(db)

        try:
            result = await extract_template_draft(
                db=db,
                document_id=document_id,
                llm_call=llm_call,
            )

            if result.get("error"):
                raise ValueError(result["error"])

            logger.info(
                "Draft extraction completed for document %s (%d fields)",
                document_id, len(result.get("fields", [])),
            )

            # Mark source document extraction status — user still needs to commit
            document = await db.get(Document, document_id)
            if document is not None:
                from sqlalchemy.orm.attributes import flag_modified
                meta = dict(document.source_metadata or {})
                meta["extraction_status"] = "draft_ready"
                document.source_metadata = meta
                flag_modified(document, "source_metadata")

            if bg_task:
                bg_task.status = "success"
                bg_task.result = result
                bg_task.error_message = None  # dọn stale error nếu là retry
                bg_task.completed_at = datetime.now(timezone.utc)
            # Phase 3 T5: success commit trên business session (atomic với doc metadata completed).
            await db.commit()

            return result
        except Exception as e:
            logger.exception("Draft extraction failed for document %s", document_id)
            # Phase 3 T5: rollback business RỒI ghi failed ở SESSION RIÊNG (sống qua rollback/
            # poison) — FE poll source_metadata.extraction_status='failed' để dừng spinner.
            await db.rollback()
            await mark_extract_status(
                session_factory, task_id, document_id, "failure", "failed", error_message=str(e),
            )
            return {"error": str(e)}
