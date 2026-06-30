"""Document Review & Analysis: AI-powered review with risk scoring.

Schema matches FE `src/app/api/endpoints/review.ts` — keyword-based highlights,
structured fixes, optional comparison, bilingual (Vi/En) output.
"""
from __future__ import annotations

import asyncio
import logging
import uuid

_log = logging.getLogger(__name__)

from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import CurrentUser
from src.core.config import get_settings
from src.core.database import get_db
from src.models.document import Document
from src.models.review import ReviewJob, ReviewJobVersion
from src.services.review_export import (
    build_legal_eval_html,
    build_tracked_changes_docx,
)
from src.services.storage import get_storage_backend

router = APIRouter(prefix="/review", tags=["review"])


from src.schemas.review import (
    QuickActionRequest,
    QuickActionResult,
    RecalculateScoreRequest,
    ReviewConfig,
    SaveSessionEventsRequest,
    SaveVersionRequest,
    SuggestChecklistRequest,
    SuggestChecklistResponse,
    UpdateStatusRequest,
    VersionResponse,
)


# ─── Constants ────────────────────────────────────────────────────────────────

from src.services.review_helpers import (
    _EDIT_RATE,
    _MAX_DOC_CHARS,
    _RISK_IMPACT,
    _SCORE_FLOOR,
    _apply_proportional_risk,
    _clamp_score,
    _clean_edit_text,
    _content_disposition,
    _dict_list,
    _edits_from_report,
    _extract_page_count,
    _find_best_verbatim_match,
    _find_clause_label,
    _get_catalog,
    _resolve_checklist_labels,
    _sanitize_user_input,
    _slugify,
    _str_list,
)

from src.services.review_helpers import (
    _convert_doc_to_docx,
    _extract_docx_numbered_items,
    _extract_docx_outline,
    _extract_text,
    _extract_track_changes,
)


# ─── Step 4: Storage helpers ──────────────────────────────────────────────────

from src.services.review_service import ReviewService

# ─── PDF pre-generation (fire-and-forget) ────────────────────────────────────

async def _persist_eval_pdf(
    job_row: ReviewJob,
    db: AsyncSession,
    *,
    pdf_bytes: bytes | None = None,
    applied_edits: dict | None = None,
    version_label: str | None = None,
) -> None:
    """Store eval-report PDF và gắn vào job (best-effort).

    Nếu pdf_bytes được cung cấp → lưu trực tiếp, không gọi Gotenberg.
    Nếu không → tự generate HTML → Gotenberg → lưu (pre-generate path).
    """
    settings = get_settings()
    if pdf_bytes is None and not settings.gotenberg_url:
        return
    try:
        from sqlalchemy import select as _sa_select
        from src.models.storage import StorageConfig

        cfg = None
        if job_row.document_id:
            doc = (await db.execute(
                _sa_select(Document).where(Document.id == job_row.document_id)
            )).scalar_one_or_none()
            if doc:
                cfg = await db.get(StorageConfig, doc.storage_config_id)
        if cfg is None:
            cfg = (await db.execute(
                _sa_select(StorageConfig).where(StorageConfig.is_default.is_(True)).limit(1)
            )).scalar_one_or_none()
        if cfg is None:
            cfg = (await db.execute(_sa_select(StorageConfig).limit(1))).scalar_one_or_none()
        if cfg is None:
            return

        if pdf_bytes is None:
            # Generate HTML rồi gọi Gotenberg (pre-generate path sau khi review xong)
            report = job_row.report
            cmp_raw = report.get("comparison")
            html = build_legal_eval_html(
                document_name=job_row.document_name,
                review_type=job_row.review_type,
                risk_score=job_row.risk_score,
                summary=str(report.get("summary", "")),
                risk_explanation=str(report.get("riskExplanation", "")),
                key_information=_dict_list(report, "keyInformation"),
                checklist=_dict_list(report, "checklist"),
                highlights=_dict_list(report, "highlights"),
                key_issues=_str_list(report, "keyIssues"),
                missing_items=_str_list(report, "missingItems"),
                detected_errors=_str_list(report, "detectedErrors"),
                edits=_edits_from_report(report),
                comparison=dict(cmp_raw) if isinstance(cmp_raw, dict) else None,
                reference_results=_dict_list(report, "referenceResults"),
                suggestions=_str_list(report, "suggestions"),
                risk_factors=_str_list(report, "riskFactors"),
                risk_breakdown=_dict_list(report, "riskBreakdown"),
                compare_mode=job_row.compare_mode,
                applied_edits=applied_edits,
                version_label=version_label,
            )
            import httpx as _httpx
            async with _httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{settings.gotenberg_url}/forms/chromium/convert/html",
                    files={"files": ("index.html", html.encode("utf-8"), "text/html")},
                    data={"paperFormat": "A4"},
                )
            if resp.status_code != 200:
                _log.warning(
                    "_persist_eval_pdf: Gotenberg returned %s for job %s", resp.status_code, job_row.id
                )
                return
            pdf_bytes = resp.content

        doc_stem = Path(job_row.document_name).stem
        pdf_filename = f"{_slugify(doc_stem)}_eval.pdf"
        backend = get_storage_backend(cfg)
        result = await backend.save(pdf_bytes, pdf_filename)

        pdf_doc = Document(
            title=f"{doc_stem}_eval",
            file_name=result.file_name,
            original_filename=pdf_filename,
            file_path=result.file_path,
            file_size=result.file_size,
            mime_type="application/pdf",
            extension="pdf",
            checksum=result.checksum,
            storage_config_id=cfg.id,
            owner_id=job_row.user_id,
            source_type="skill_temp",
            source_metadata={"review_job_id": str(job_row.id)},
        )
        db.add(pdf_doc)
        await db.flush()
        await db.refresh(pdf_doc)
        job_row.pdf_document_id = pdf_doc.id
        # Phase 3 — COMMIT CỐ Ý: _persist_eval_pdf chạy trong asyncio background (ngoài
        # request boundary) → phải tự commit. KHÔNG gỡ.
        await db.commit()
        _log.info("_persist_eval_pdf: stored PDF %s for job %s", pdf_doc.id, job_row.id)
    except Exception:
        _log.warning("_persist_eval_pdf: failed for job %s", job_row.id, exc_info=True)


# ─── Job loader ───────────────────────────────────────────────────────────────



# ═══════════════════════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════


# ─── POST /review/start ───────────────────────────────────────────────────────
# Bắt đầu một review job:
#   1. Đọc bytes tài liệu chính + template (nếu compare_enabled) + reference docs
#   2. Extract text song song (to_thread) để không block event loop
#   3. Gọi _run_review → ReviewReport
#   4. Lưu job vào DB, lưu _doc_text vào report để quick_action dùng lại sau
#   5. Fire-and-forget PDF generation
#   6. Trả job_id + metadata ngay lập tức


@router.post("/start")
async def start_review(
    body: ReviewConfig,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    # 1. Đọc tài liệu chính
    doc_name, doc_bytes = await ReviewService(db).read_document_bytes(body.document_id, current_user)

    # 2. Extract text, outline, track changes song song
    doc_text = await asyncio.to_thread(_extract_text, doc_bytes, doc_name)
    doc_outline = await asyncio.to_thread(_extract_docx_outline, doc_bytes, doc_name)
    doc_revisions = _extract_track_changes(doc_bytes, doc_name)

    # 3. Đọc template documents (nếu compare_enabled)
    template_text: str | None = None
    template_outline: str | None = None
    template_revisions: list[dict] = []
    primary_compare_id: uuid.UUID | None = None
    if body.compare_enabled and body.compare_document_ids:
        template_parts: list[str] = []
        template_outline_parts: list[str] = []
        n_tmpl = len(body.compare_document_ids[:3])
        per_cap = max(50000, 200000 // n_tmpl)
        for idx, cid in enumerate(body.compare_document_ids[:3]):
            try:
                tmpl_name, tmpl_bytes = await ReviewService(db).read_document_bytes(cid, current_user)
                tmpl_text = await asyncio.to_thread(_extract_text, tmpl_bytes, tmpl_name)
                tmpl_revs = _extract_track_changes(tmpl_bytes, tmpl_name)
                tmpl_outline = await asyncio.to_thread(_extract_docx_outline, tmpl_bytes, tmpl_name)
                header = f"[TEMPLATE {idx + 1}: {tmpl_name}]" if n_tmpl > 1 else ""
                template_parts.append(f"{header}\n{tmpl_text[:per_cap]}" if header else tmpl_text[:per_cap])
                if tmpl_outline:
                    ol_header = f"[TEMPLATE {idx + 1}: {tmpl_name}]" if n_tmpl > 1 else ""
                    template_outline_parts.append(f"{ol_header}\n{tmpl_outline}" if ol_header else tmpl_outline)
                if not template_revisions:
                    template_revisions = tmpl_revs
                if primary_compare_id is None:
                    try:
                        primary_compare_id = uuid.UUID(cid)
                    except ValueError:
                        pass
            except HTTPException:
                continue
        if template_parts:
            template_text = "\n\n---\n\n".join(template_parts)
        if template_outline_parts:
            template_outline = "\n\n---\n\n".join(template_outline_parts)

    # 4. Đọc reference documents (nếu reference_enabled)
    reference_texts: list[tuple[str, str]] = []
    if body.reference_enabled and body.reference_doc_ids:
        for rid in body.reference_doc_ids[:5]:
            try:
                ref_name, ref_bytes = await ReviewService(db).read_document_bytes(rid, current_user)
                ref_text = await asyncio.to_thread(_extract_text, ref_bytes, ref_name)
                reference_texts.append((ref_name, ref_text))
            except HTTPException:
                continue

    # 5. Resolve checklist labels từ catalog
    checklist_labels = _resolve_checklist_labels(body.review_type, body.checklist_item_ids)

    compare_mode = (
        "tracked" if template_text and (doc_revisions or template_revisions)
        else ("semantic" if template_text else None)
    )

    # 6. Run review pipeline
    job_id = str(uuid.uuid4())
    report = await ReviewService(db).run_review(
        job_id, doc_name, doc_text, body, checklist_labels, template_text,
        doc_revisions=doc_revisions,
        template_revisions=template_revisions,
        reference_texts=reference_texts or None,
        doc_outline=doc_outline,
        template_outline=template_outline,
    )

    # 7. Serialize report, lưu _doc_text để quick_action dùng lại ĐÚNG text
    #    mà LLM đã thấy (tránh re-extract tạo ra encoding/line-break khác → match fail)
    report_dict = report.model_dump()
    if doc_text and len(doc_text) < 500_000:
        report_dict["_doc_text"] = doc_text

    # 8. Persist job row
    job_row = ReviewJob(
        id=uuid.UUID(job_id),
        user_id=current_user.id,
        document_id=uuid.UUID(body.document_id),
        compare_document_id=primary_compare_id,
        document_name=doc_name,
        review_type=body.review_type,
        compare_mode=compare_mode,
        status="reviewing",
        risk_score=report.riskScore,
        report=report_dict,
    )
    db.add(job_row)
    # Phase 3 — COMMIT CỐ Ý (commit-trước-background): job_row phải BỀN trước khi spawn
    # _persist_eval_pdf (asyncio background đọc job_row + ghi pdf). KHÔNG gỡ.
    await db.commit()

    # 9. Fire-and-forget PDF pre-generation (không block response)
    asyncio.create_task(_persist_eval_pdf(job_row, db))

    return {
        "job_id": job_id,
        "status": "completed",
        "compare_mode": compare_mode,
        "revisions_detected": {
            "document": len(doc_revisions),
            "template": len(template_revisions),
        },
    }


# ─── GET /review/result/{job_id} ─────────────────────────────────────────────

@router.get("/result/{job_id}")
async def get_review_result(
    job_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Lấy kết quả review đã lưu. Không mutate row.report — build response dict riêng."""
    row = await ReviewService(db).load_job(job_id, current_user.id)
    result = dict(row.report)
    result["sessionEvents"] = row.session_events or []
    return result


# ─── GET /review/document-text/{document_id} ─────────────────────────────────
# Dùng bởi FE để lấy plain text trước khi bắt đầu review.
# FE dùng text này để render preview, inject clause numbers từ numbering endpoint.

@router.get("/document-text/{document_id}")
async def get_document_text(
    document_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    filename, doc_bytes = await ReviewService(db).read_document_bytes(document_id, current_user)
    text = _extract_text(doc_bytes, filename)
    page_count = _extract_page_count(doc_bytes, filename)
    return {"document_id": document_id, "filename": filename, "text": text, "page_count": page_count}


# ─── GET /review/document-numbering/{document_id} ────────────────────────────
# Trả numbering map để FE inject số điều khoản vào mammoth.js rendered HTML.
# mammoth.js bỏ auto-generated numbers → FE dùng map này để restore.

@router.get("/document-numbering/{document_id}")
async def get_document_numbering(
    document_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    filename, doc_bytes = await ReviewService(db).read_document_bytes(document_id, current_user)
    items = await asyncio.to_thread(_extract_docx_numbered_items, doc_bytes, filename)
    return {
        "document_id": document_id,
        "items": [{"label": label, "text": text[:200]} for label, text in items],
    }


# ─── POST /review/suggest-checklist ──────────────────────────────────────────
# AI suggest các checklist items phù hợp nhất với tài liệu.
# Smart sampling: head + mid + tail để không bỏ qua điều khoản quan trọng ở giữa/cuối.

_SUGGEST_HEAD = 2500
_SUGGEST_MID = 1500
_SUGGEST_TAIL = 2000


def _sample_doc_text(full_text: str) -> str:
    """Sample head + mid + tail để detect document type mà không bỏ qua nội dung cuối."""
    total = _SUGGEST_HEAD + _SUGGEST_MID + _SUGGEST_TAIL
    if len(full_text) <= total:
        return full_text
    mid_start = max(_SUGGEST_HEAD, len(full_text) // 2 - _SUGGEST_MID // 2)
    return (
        full_text[:_SUGGEST_HEAD]
        + "\n…\n"
        + full_text[mid_start : mid_start + _SUGGEST_MID]
        + "\n…\n"
        + full_text[-_SUGGEST_TAIL:]
    )


@router.post("/suggest-checklist", response_model=SuggestChecklistResponse)
async def suggest_checklist(
    body: SuggestChecklistRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    from src.models.document import DocumentContent

    try:
        doc_uuid = uuid.UUID(body.document_id)
    except (ValueError, AttributeError):
        raise HTTPException(400, f"Invalid document_id: {body.document_id}")

    # Ưu tiên dùng cached raw_text nếu có (tránh re-extract)
    content_row = (
        await db.execute(select(DocumentContent).where(DocumentContent.document_id == doc_uuid))
    ).scalar_one_or_none()

    if content_row and content_row.raw_text:
        doc_text = _sample_doc_text(content_row.raw_text)
    else:
        doc_name, doc_bytes = await ReviewService(db).read_document_bytes(body.document_id, current_user)
        doc_text = _sample_doc_text(_extract_text(doc_bytes, doc_name))

    catalog = _get_catalog(body.review_type)
    items_str = "\n".join(f'  - id="{cid}": {label}' for cid, label in catalog.items())

    prompt = (
        f"Loại tài liệu: {body.review_type}\n\n"
        f"Trích đoạn tài liệu:\n<untrusted_data>\n{doc_text}\n</untrusted_data>\n\n"
        f"Danh sách checklist có sẵn:\n{items_str}\n\n"
        "Dựa vào nội dung tài liệu, chọn các mục checklist QUAN TRỌNG NHẤT và PHÙ HỢP NHẤT.\n"
        "Ưu tiên: (1) mục liên quan trực tiếp đến loại hợp đồng/tài liệu, "
        "(2) mục có khả năng phát hiện rủi ro cao, "
        "(3) bỏ qua mục không áp dụng cho loại tài liệu này.\n"
        "Trả về JSON hợp lệ (không có markdown):\n"
        '{"suggested_ids": ["<id1>", "<id2>", ...]}\n'
        "Chọn 4-8 IDs phù hợp nhất. Không chọn các mục rõ ràng không liên quan."
    )

    data = await ReviewService(db).call_llm(prompt)
    ids = [str(i) for i in (data.get("suggested_ids") or []) if str(i) in catalog]
    return SuggestChecklistResponse(suggested_ids=ids)


# ─── POST /review/start/quick-action ─────────────────────────────────────────
# Post-review preset actions: improve / optimize / reduce.
# Sinh thêm edits cụ thể mà LLM đề xuất, không lưu vào DB ngay.
# Người dùng review → apply (gọi recalculate-score để cập nhật điểm).
#
# LƯU Ý QUAN TRỌNG:
#   - Dùng _doc_text đã lưu từ lúc review ban đầu để verbatim match chính xác.
#   - suggested_edits bao gồm modified_text verbatim từ doc → FE highlight được.
#   - Score KHÔNG thay đổi ở đây — chỉ thay đổi sau khi user apply (recalculate-score).

@router.post("/start/quick-action", response_model=QuickActionResult)
async def quick_action(
    body: QuickActionRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    row = await ReviewService(db).load_job(body.job_id, current_user.id)
    report_data = dict(row.report or {})

    # Trích xuất outline để phục vụ gán nhãn chính xác
    doc_outline = None
    if row.document_id:
        try:
            _, doc_bytes = await ReviewService(db).read_document_bytes(str(row.document_id), current_user)
            doc_outline = await asyncio.to_thread(_extract_docx_outline, doc_bytes, row.document_name)
        except Exception:
            pass

    # Ưu tiên dùng text đã lưu — đảm bảo khớp với modified_text LLM đã thấy
    doc_text_for_action = report_data.get("_doc_text") or ""
    if not doc_text_for_action and row.document_id:
        try:
            if 'doc_bytes' in locals():
                doc_text_for_action = _extract_text(doc_bytes, row.document_name)[:_MAX_DOC_CHARS]
            else:
                _, doc_bytes_alt = await ReviewService(db).read_document_bytes(str(row.document_id), current_user)
                doc_text_for_action = _extract_text(doc_bytes_alt, row.document_name)[:_MAX_DOC_CHARS]
        except Exception:
            pass

    # Action instruction: dùng user instruction nếu có, fallback về preset
    if body.user_instruction and body.user_instruction.strip():
        action_instruction = f"<untrusted_data>{_sanitize_user_input(body.user_instruction)}</untrusted_data>"
    else:
        action_instruction = {
            "improve": (
                "Đề xuất cải thiện cụ thể để làm tài liệu rõ ràng, đầy đủ và dễ thực thi hơn. "
                "Ưu tiên điều khoản/đoạn có thể sửa trực tiếp bằng văn bản thay thế."
            ),
            "optimize": (
                "Đề xuất tối ưu hóa thương mại/vận hành: thanh toán, timeline, KPI, milestone, "
                "cơ chế thông báo, trách nhiệm thực hiện, hoặc điều kiện nghiệm thu."
            ),
            "reduce": (
                "Đề xuất giảm thiểu rủi ro: giới hạn trách nhiệm, phạt/đền bù, chấm dứt, "
                "bất khả kháng, bảo mật, dữ liệu, tuân thủ hoặc tranh chấp."
            ),
        }[body.action_type]

    initial_context_block = ""
    if body.additional_requirements and body.additional_requirements.strip():
        initial_context_block = (
            "\n[USER_CONTEXT_FROM_INITIAL_REVIEW]\n"
            "This was the user's focus instruction from when the document was first reviewed. "
            "Use it to stay consistent with the original review intent.\n"
            f"<untrusted_data>{_sanitize_user_input(body.additional_requirements)}</untrusted_data>\n"
        )

    is_bilingual = bool(report_data.get("is_bilingual", False))
    current_score = _clamp_score(report_data.get("riskScore", 50))
    key_issues = report_data.get("keyIssues", []) or []
    missing_items = report_data.get("missingItems", []) or []
    summary_text = report_data.get("summary", "")
    existing_edits = (report_data.get("comparison") or {}).get("edits") or []

    # Context về edits đã có — LLM không repeat chúng
    edit_context = ""
    if existing_edits:
        edit_context = "Already flagged edits; do not repeat them:\n" + "\n".join(
            f"- [{e.get('clause_name','')}] {str(e.get('modified_text',''))[:120]}"
            for e in existing_edits[:10]
        )

    # Bilingual prompt injection khi cần
    bilingual_section = ""
    bilingual_schema_fields = ""
    bilingual_rules_extra = ""
    if is_bilingual:
        bilingual_section = """
[BILINGUAL DOCUMENT — MANDATORY]
This document contains PARALLEL Vietnamese and English text.
PRIMARY language = Vietnamese. SECONDARY language = English.
For EVERY edit, provide BOTH language versions:
  - modified_text / suggested_text → PRIMARY (Vietnamese, verbatim from document)
  - bilingual_modified_text → SECONDARY English paragraph, verbatim from document
  - bilingual_suggested_text → complete English replacement (same meaning as suggested_text)
"""
        bilingual_schema_fields = (
            '      "bilingual_modified_text": "verbatim English paragraph from document",'
            '\n      "bilingual_suggested_text": "complete English replacement synchronized with suggested_text",'
        )
        bilingual_rules_extra = (
            "9. BILINGUAL: every edit MUST have non-null bilingual_modified_text AND bilingual_suggested_text.\n"
            "10. bilingual_modified_text must be copied verbatim from the English section of the document.\n"
            "11. bilingual_suggested_text must be a complete English replacement semantically synchronized with suggested_text."
        )

    prompt = f"""
You are applying a post-review action to an already reviewed document.

[ACTION]
{action_instruction}
{initial_context_block}{bilingual_section}
[CURRENT_REVIEW]
Summary: {summary_text}
Current riskScore: {current_score}/100
Key issues: {'; '.join(str(x) for x in key_issues) or '(none)'}
Missing items: {'; '.join(str(x) for x in missing_items) or '(none)'}

[ALREADY_FLAGGED_EDITS]
{edit_context or '(none)'}

[DOCUMENT_TEXT_FOR_VERBATIM_MATCHING]
<untrusted_data>
{doc_text_for_action}
</untrusted_data>

[TASK]
Suggest 1-5 additional concrete edits that best support the requested action.
Do not repeat already flagged edits.
CRITICAL: modified_text must be copied CHARACTER-FOR-CHARACTER from the document above.
Verify that BOTH the first 40 chars AND a middle segment of your modified_text appear verbatim in the document.
If you cannot find the exact sentence in the document text, DO NOT include that edit.
Prefer 1-2 high-confidence edits over 5 uncertain ones. Return empty array if unsure.

[OUTPUT]
Return valid JSON only:
{{
  "summary": "2-3 sentences explaining what improvement is proposed and why risk is reduced",
  "newScore": {current_score},
  "suggested_edits": [
    {{
      "clause_name": "short clause/section name",
      "modified_text": "EXACT character-for-character copy of the sentence/paragraph from the document",
      "suggested_text": "complete replacement text ready to paste into the document",
      "reason": "specific risk if unchanged and legal/business/financial basis",
      "risk_level": "high|medium|low",
      "suggestion_category": "improve|reduce|rewrite",
{bilingual_schema_fields}    }}
  ]
}}

[RULES]
1. The response language for summary/reason must match the document language.
2. newScore must be lower than the current riskScore only if the proposed edits materially reduce risk.
3. If suggested_edits is empty, newScore must stay equal to current riskScore.
4. modified_text must be a character-perfect copy from the document — no paraphrasing, no reconstructing from memory.
5. suggested_text must be a complete replacement for that single paragraph/cell, not an instruction.
6. Do not invent clauses, numbers, parties, dates, or legal citations not present in the document.
7. suggestion_category: "improve" = clarity/quality/completeness edits; "reduce" = liability/risk/penalty/termination/dispute edits; "rewrite" = full clause restructuring edits.
8. When proposing a new clause or paragraph addition, use the preceding clause/paragraph as the anchor (`modified_text`). In `suggested_text`, include the exact text of the preceding clause/paragraph, followed by a newline (`\n`), and then the new clause/paragraph. Do not concatenate them without a newline.
{bilingual_rules_extra}
"""

    data = await ReviewService(db).call_llm(prompt)

    raw_edits = data.get("suggested_edits") or []
    suggested_edits: list[dict] = []
    for e in raw_edits:
        if not isinstance(e, dict):
            continue
        modified_text = _clean_edit_text(str(e.get("modified_text") or ""))
        suggested_text = str(e.get("suggested_text") or "").strip()
        if not modified_text or not suggested_text:
            continue
        # Verbatim check với fuzzy recovery
        verbatim_ok, matched_text = _find_best_verbatim_match(modified_text, doc_text_for_action) if doc_text_for_action else (True, modified_text)
        if not verbatim_ok:
            continue
        modified_text = matched_text
        
        # Đối chiếu tìm nhãn điều khoản chính xác
        resolved_label = _find_clause_label(matched_text, doc_outline)
        clause_name = resolved_label if resolved_label else str(e.get("clause_name", ""))
        
        risk_level = str(e.get("risk_level", "medium")).lower()
        if risk_level not in _RISK_IMPACT:
            risk_level = "medium"
        edit_entry: dict = {
            "clause_name": clause_name,
            "modified_text": modified_text,
            "suggested_text": suggested_text,
            "reason": str(e.get("reason", "")),
            "risk_level": risk_level,
            "verdict": "disagree",
            "anchor_text": _clean_edit_text(modified_text[:45]),
            "score_impact": _RISK_IMPACT[risk_level],
            "verbatim_match": True,
            "is_quick_action": True,
            "suggestion_category": str(e.get("suggestion_category", "")).strip()
                if str(e.get("suggestion_category", "")).strip() in ("improve", "reduce", "rewrite")
                else ("reduce" if body.action_type == "reduce" else "improve"),
        }
        if is_bilingual:
            b_modified = _clean_edit_text(str(e.get("bilingual_modified_text") or "")) or None
            b_suggested = str(e.get("bilingual_suggested_text") or "").strip() or None
            # Bilingual edit thiếu EN version → invalid, discard
            if not b_modified or not b_suggested:
                continue
            b_verbatim_ok, b_matched = _find_best_verbatim_match(b_modified, doc_text_for_action) if doc_text_for_action else (True, b_modified)
            if not b_verbatim_ok:
                continue
            b_modified = b_matched
            edit_entry["bilingual_modified_text"] = b_modified
            edit_entry["bilingual_suggested_text"] = b_suggested
            edit_entry["bilingual_anchor_text"] = _clean_edit_text(b_modified[:45])
        suggested_edits.append(edit_entry)

    summary = str(data.get("summary", "")).strip()
    if not summary:
        summary = (
            "Đã đề xuất chỉnh sửa cụ thể để giảm rủi ro."
            if suggested_edits
            else "Không tìm thấy chỉnh sửa mới đủ chắc chắn để áp dụng tự động."
        )

    return QuickActionResult(
        type=body.action_type,
        summary=summary,
        newScore=current_score,  # score only changes after user applies edits + recalculate-score
        suggested_edits=suggested_edits or None,
    )


# ─── POST /review/jobs/{job_id}/recalculate-score ────────────────────────────
# Tính lại risk score sau khi user apply edits — không gọi LLM.
# Dùng cùng _apply_proportional_risk (mirror safety) để nhất quán với
# _calculate_formula_score.

@router.post("/jobs/{job_id}/recalculate-score")
async def recalculate_score(
    job_id: str,
    body: RecalculateScoreRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    row = await ReviewService(db).load_job(job_id, current_user.id)
    # dict() tạo bản sao mới — cần thiết vì JSONB không track in-place mutation
    report_data = dict(row.report or {})

    # _baseRiskScore = điểm gốc từ AI, trước bất kỳ edit nào.
    # Lưu một lần rồi dùng mãi để tránh double-count khi user apply nhiều edits.
    if "_baseRiskScore" not in report_data:
        report_data["_baseRiskScore"] = int(report_data.get("riskScore", 50))

    base_score = int(report_data["_baseRiskScore"])

    applied_edits = body.applied_edits or {}

    rc_items = [
        (str(info.get("riskLevel", "medium")).lower(), _EDIT_RATE)
        for info in applied_edits.values()
        if isinstance(info, dict)
    ]
    rc_safety = 100.0 - float(base_score)
    new_score = max(_SCORE_FLOOR, round(100.0 - _apply_proportional_risk(rc_safety, rc_items)))
    delta = base_score - new_score

    n = len(applied_edits)
    if delta > 0:
        summary = f"Đã áp dụng {n} chỉnh sửa, điểm rủi ro giảm {delta} điểm ({base_score} → {new_score})."
    else:
        summary = f"Đã áp dụng {n} chỉnh sửa." if n > 0 else "Chưa có chỉnh sửa nào được áp dụng."

    # ── Merge quick-action edits vào comparison.edits ────────────────────────
    # quick_action_edits là các edits mới sinh bởi quick-action mà FE đã hiển thị.
    # Nếu không merge vào report thì khi reload từ history / version,
    # các edits này biến mất và điểm của các điều khoản đó không còn.
    if body.quick_action_edits:
        cmp = report_data.get("comparison")
        if not isinstance(cmp, dict):
            cmp = {"is_identical": False, "differences": [], "missingClauses": [], "conflictTerms": [], "edits": []}
            report_data["comparison"] = cmp
        existing_edits: list[dict] = cmp.get("edits") or []
        # Dedup bằng modified_text — không thêm lại edit đã có
        existing_mod_texts = {str(e.get("modified_text", "")) for e in existing_edits}
        new_edits_to_add = [
            e for e in body.quick_action_edits
            if isinstance(e, dict)
            and str(e.get("modified_text", "")) not in existing_mod_texts
        ]
        if new_edits_to_add:
            # Đảm bảo đây là list mới (tránh mutate cached reference)
            cmp["edits"] = list(existing_edits) + new_edits_to_add
            report_data["comparison"] = dict(cmp)
            _log.info(
                "recalculate_score: merged %d quick-action edits into job %s comparison.edits",
                len(new_edits_to_add), job_id,
            )

    report_data["riskScore"] = new_score
    report_data["_appliedEdits"] = applied_edits
    row.report = report_data
    row.risk_score = new_score
    row.pdf_document_id = None  # Invalidate cached PDF — report đã thay đổi
    # Phase 3: commit ở boundary (get_db).
    await db.flush()

    return {"newScore": new_score, "originalScore": base_score, "delta": delta, "summary": summary}


# ─── Version management ───────────────────────────────────────────────────────

@router.post("/jobs/{job_id}/versions", response_model=VersionResponse, status_code=201)
async def save_version(
    job_id: str,
    body: SaveVersionRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> VersionResponse:
    row = await ReviewService(db).load_job(job_id, current_user.id)

    merged_result = dict(body.result)
    if body.applied_edits:
        merged_result["_appliedEdits"] = body.applied_edits
        # Invalidate cached PDF so next download regenerates with applied-edit state
        row.pdf_document_id = None

    # Mark edits that are new (not in original report) as quick_action for PDF badge
    cmp_orig = (row.report or {}).get("comparison") or {}
    orig_mod_texts = {
        e.get("modified_text", "")
        for e in (cmp_orig.get("edits") or [])
        if isinstance(e, dict)
    }
    cmp_ver = merged_result.get("comparison") or {}
    ver_evals = cmp_ver.get("edits")
    if isinstance(ver_evals, list):
        for e in ver_evals:
            if isinstance(e, dict) and e.get("modified_text", "") not in orig_mod_texts:
                e["is_quick_action"] = True

    version = ReviewJobVersion(
        job_id=row.id,
        version_num=body.version_num,
        label=body.label,
        version_type=body.type,
        score=body.score,
        review_type=body.review_type,
        result=merged_result,
    )
    db.add(version)
    row.risk_score = body.score
    row.report = merged_result
    # Phase 3: commit ở boundary (get_db).
    await db.flush()
    await db.refresh(version)

    result_data = dict(version.result)
    applied_edits = result_data.pop("_appliedEdits", None)
    return VersionResponse(
        id=str(version.id),
        version_num=version.version_num,
        label=version.label,
        type=version.version_type,
        score=version.score,
        review_type=version.review_type,
        result=result_data,
        created_at=version.created_at.isoformat(),
        applied_edits=applied_edits,
    )


@router.get("/jobs/{job_id}/versions", response_model=list[VersionResponse])
async def get_versions(
    job_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[VersionResponse]:
    row = await ReviewService(db).load_job(job_id, current_user.id)

    stmt = (
        select(ReviewJobVersion)
        .where(ReviewJobVersion.job_id == row.id)
        .order_by(ReviewJobVersion.version_num)
    )
    versions = (await db.execute(stmt)).scalars().all()

    def _to_response(v: ReviewJobVersion) -> VersionResponse:
        result_data = dict(v.result)
        applied_edits = result_data.pop("_appliedEdits", None)
        return VersionResponse(
            id=str(v.id),
            version_num=v.version_num,
            label=v.label,
            type=v.version_type,
            score=v.score,
            review_type=v.review_type,
            result=result_data,
            created_at=v.created_at.isoformat(),
            applied_edits=applied_edits,
        )

    return [_to_response(v) for v in versions]


# ─── History management ───────────────────────────────────────────────────────

@router.get("/history")
async def list_history(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    stmt = (
        select(ReviewJob)
        .where(ReviewJob.user_id == current_user.id, ReviewJob.deleted_at.is_(None))
        .order_by(ReviewJob.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "items": [
            {
                "id": str(row.id),
                "document_name": row.document_name,
                "review_type": row.review_type,
                "compare_mode": row.compare_mode,
                "status": row.status,
                "risk_score": row.risk_score,
                "created_at": row.created_at.isoformat(),
            }
            for row in rows
        ]
    }


@router.delete("/history/{job_id}")
async def delete_history_item(
    job_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    from datetime import timezone as tz

    row = await ReviewService(db).load_job(job_id, current_user.id)
    row.deleted_at = datetime.now(tz.utc)
    # Phase 3: commit ở boundary (get_db).
    await db.flush()
    return {"status": "deleted", "job_id": job_id}


@router.patch("/history/{job_id}/status")
async def update_review_status(
    job_id: str,
    body: UpdateStatusRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    row = await ReviewService(db).load_job(job_id, current_user.id)
    row.status = body.status
    # Phase 3: commit ở boundary (get_db).
    await db.flush()
    return {"job_id": job_id, "status": row.status}


@router.patch("/jobs/{job_id}/session-events")
async def save_session_events(
    job_id: str,
    body: SaveSessionEventsRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    row = await ReviewService(db).load_job(job_id, current_user.id)
    row.session_events = [e.model_dump() for e in body.events]
    # Phase 3: commit ở boundary (get_db).
    await db.flush()
    return {"job_id": job_id, "count": len(body.events)}


# ─── Export endpoints ─────────────────────────────────────────────────────────

@router.get("/result/{job_id}/tracked-changes.docx")
async def download_tracked_changes(
    job_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Download DOCX với tracked changes từ AI edits.

    Path A: python-docx trên DOCX gốc với formatting preserve.
    Path B: plain-text reconstruction (fallback khi không có DOCX gốc).
    .doc: convert sang .docx via LibreOffice trước khi dùng Path A.
    """
    import traceback

    row = await ReviewService(db).load_job(job_id, current_user.id)
    report = row.report  # source of _doc_text (not versioned) + fallback for edits

    # Tìm version mới nhất có _appliedEdits.
    # QUAN TRỌNG: dùng CÙNG version cho cả edits list lẫn applied_edits dict —
    # tránh mismatch khi user đã thêm edits mới (quick action) và apply chúng.
    # _doc_text KHÔNG được versioned (FE không gửi khi save_version) → luôn lấy từ row.report.
    applied_edits: dict = report.get("_appliedEdits", {}) if isinstance(report, dict) else {}
    edits_report: dict = report  # fallback = original review
    try:
        ver_result = await db.execute(
            select(ReviewJobVersion)
            .where(ReviewJobVersion.job_id == row.id)
            .order_by(ReviewJobVersion.version_num.desc())
            .limit(20)
        )
        for ver in ver_result.scalars():
            ae = ver.result.get("_appliedEdits", {}) if isinstance(ver.result, dict) else {}
            if ae:
                applied_edits = ae
                edits_report = ver.result  # edits từ cùng version với applied_edits
                _log.info(
                    "download_tracked_changes: using version %d edits (%d applied)",
                    ver.version_num, len(ae),
                )
                break
    except Exception:
        pass

    doc_text = ""
    orig_doc_bytes: bytes = b""
    try:
        _, orig_doc_bytes = await ReviewService(db).read_document_bytes(str(row.document_id), current_user)
        # _doc_text từ row.report (không versioned) — đảm bảo Path B dùng ĐÚNG text LLM đã thấy
        doc_text = report.get("_doc_text") or _extract_text(orig_doc_bytes, row.document_name)
    except Exception:
        pass

    # .doc → convert sang .docx cho Path A
    _doc_ext = row.document_name.rsplit(".", 1)[-1].lower() if "." in row.document_name else ""
    if _doc_ext == "doc" and orig_doc_bytes:
        _converted = await asyncio.to_thread(_convert_doc_to_docx, orig_doc_bytes)
        if _converted:
            _log.info("DOC→DOCX conversion succeeded (%.1f KB) — using Path A", len(_converted) / 1024)
            orig_doc_bytes = _converted
        else:
            _log.info("DOC→DOCX conversion unavailable — Path B (text reconstruction) will be used")

    try:
        docx_bytes = build_tracked_changes_docx(
            document_name=row.document_name,
            review_type=row.review_type,
            risk_score=row.risk_score,
            summary=str(edits_report.get("summary", "") or report.get("summary", "")),
            edits=_edits_from_report(edits_report),
            doc_text=doc_text,
            doc_bytes=orig_doc_bytes,
            checklist=_dict_list(edits_report, "checklist") or _dict_list(report, "checklist"),
            missing_items=_str_list(edits_report, "missingItems") or _str_list(report, "missingItems"),
            suggestions=_str_list(edits_report, "suggestions") or _str_list(report, "suggestions"),
            applied_edits=applied_edits,
        )
    except Exception as exc:
        _log.error("build_tracked_changes_docx failed: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"DOCX generation error: {exc}")

    doc_stem_docx = Path(row.document_name).stem
    fname_ascii   = f"{_slugify(doc_stem_docx)}.docx"
    fname_display = f"{doc_stem_docx}.docx"
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": _content_disposition(fname_ascii, fname_display)},
    )


@router.get("/result/{job_id}/eval-report.pdf")
async def download_eval_report_pdf(
    job_id: str,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """Download PDF evaluation report.

    Fast path: serve pre-generated PDF từ storage (không block).
    Slow path: generate on-demand via Gotenberg, store cho lần sau.
    Fallback: trả HTML nếu Gotenberg không có hoặc lỗi.
    """
    import httpx

    row = await ReviewService(db).load_job(job_id, current_user.id)

    doc_stem = Path(row.document_name).stem
    fname_pdf_ascii    = f"{_slugify(doc_stem)}.pdf"
    fname_html_ascii   = f"{_slugify(doc_stem)}.html"
    fname_pdf_display  = f"{doc_stem}.pdf"
    fname_html_display = f"{doc_stem}.html"

    # ── Fast path: serve pre-cached PDF (không cần build HTML) ────────────────
    if row.pdf_document_id:
        try:
            from src.models.storage import StorageConfig
            pdf_doc = await db.get(Document, row.pdf_document_id)
            if pdf_doc and pdf_doc.deleted_at is None:
                cfg = await db.get(StorageConfig, pdf_doc.storage_config_id)
                if cfg:
                    backend = get_storage_backend(cfg)
                    cached_bytes = await backend.read(pdf_doc.file_path)
                    return Response(
                        content=cached_bytes,
                        media_type="application/pdf",
                        headers={"Content-Disposition": _content_disposition(fname_pdf_ascii, fname_pdf_display)},
                    )
        except Exception:
            _log.warning("download_eval_report_pdf: cached PDF unavailable for job %s, regenerating", job_id)

    # ── Slow path: build HTML (chỉ khi cache miss) ────────────────────────────
    # Dùng cùng version có _appliedEdits để edits + applied_edits nhất quán.
    # row.report giữ nguyên làm fallback cho các trường không có trong version.
    report = row.report
    pdf_applied_edits: dict | None = report.get("_appliedEdits", {}) if isinstance(report, dict) else {}
    pdf_edits_report: dict = report
    pdf_version_label: str | None = None
    try:
        _ver_res = await db.execute(
            select(ReviewJobVersion)
            .where(ReviewJobVersion.job_id == row.id)
            .order_by(ReviewJobVersion.version_num.desc())
            .limit(20)
        )
        for _ver in _ver_res.scalars():
            _ae = _ver.result.get("_appliedEdits", {}) if isinstance(_ver.result, dict) else {}
            if _ae:
                pdf_applied_edits = _ae
                pdf_edits_report = _ver.result
                pdf_version_label = f"V{_ver.version_num} — {_ver.label}" if _ver.label else f"Phiên bản {_ver.version_num}"
                break
    except Exception:
        pass

    cmp_raw = pdf_edits_report.get("comparison")
    html = build_legal_eval_html(
        document_name=row.document_name,
        review_type=row.review_type,
        risk_score=row.risk_score,
        summary=str(pdf_edits_report.get("summary", "") or report.get("summary", "")),
        risk_explanation=str(report.get("riskExplanation", "")),
        key_information=_dict_list(report, "keyInformation"),
        checklist=_dict_list(pdf_edits_report, "checklist") or _dict_list(report, "checklist"),
        highlights=_dict_list(report, "highlights"),
        key_issues=_str_list(pdf_edits_report, "keyIssues") or _str_list(report, "keyIssues"),
        missing_items=_str_list(pdf_edits_report, "missingItems") or _str_list(report, "missingItems"),
        detected_errors=_str_list(report, "detectedErrors"),
        edits=_edits_from_report(pdf_edits_report),
        comparison=dict(cmp_raw) if isinstance(cmp_raw, dict) else None,
        reference_results=_dict_list(report, "referenceResults"),
        suggestions=_str_list(pdf_edits_report, "suggestions") or _str_list(report, "suggestions"),
        risk_factors=_str_list(report, "riskFactors"),
        risk_breakdown=_dict_list(report, "riskBreakdown"),
        compare_mode=row.compare_mode,
        applied_edits=pdf_applied_edits,
        version_label=pdf_version_label,
    )

    settings = get_settings()
    gotenberg_url = settings.gotenberg_url

    if not gotenberg_url:
        # Gotenberg không cấu hình → trả HTML
        return Response(
            content=html.encode("utf-8"),
            media_type="text/html",
            headers={"Content-Disposition": _content_disposition(fname_html_ascii, fname_html_display)},
        )

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{gotenberg_url}/forms/chromium/convert/html",
                files={"files": ("index.html", html.encode("utf-8"), "text/html")},
                data={"paperFormat": "A4"},
            )
        if resp.status_code == 200:
            pdf_content = resp.content
            # Store for future downloads — pass bytes trực tiếp, không gọi Gotenberg lần 2
            try:
                await _persist_eval_pdf(row, db, pdf_bytes=pdf_content, applied_edits=pdf_applied_edits, version_label=pdf_version_label)
            except Exception:
                pass
            return Response(
                content=pdf_content,
                media_type="application/pdf",
                headers={"Content-Disposition": _content_disposition(fname_pdf_ascii, fname_pdf_display)},
            )
        _log.error(
            "Gotenberg PDF conversion failed: status=%s url=%s body=%s",
            resp.status_code, gotenberg_url, resp.text[:300],
        )
    except Exception as exc:
        _log.error("Gotenberg unreachable at %s: %r", gotenberg_url, exc)

    # ── Fallback: HTML ─────────────────────────────────────────────────────────
    _log.warning("Falling back to HTML export for job %s", job_id)
    return Response(
        content=html.encode("utf-8"),
        media_type="text/html",
        headers={"Content-Disposition": _content_disposition(fname_html_ascii, fname_html_display)},
    )