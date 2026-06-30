"""Phase 8 (slice B2) — ReviewService: business-logic DB-touching cho document review.

Tách khỏi route `api/v1/routes/review.py` (god-module). Chứa 5 hàm DB-touching (đọc tài liệu +
permission, gọi LLM qua AIGateway, orchestration _run_review, load job) dưới dạng module-level
(giữ verbatim) + facade class `ReviewService(session)` để route/test dùng `svc.method(...)`.
Import helper từ review_helpers + model từ schemas.review → KHÔNG vi phạm "Services must not import api".
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import get_settings
from src.models.document import Document
from src.models.review import ReviewJob
from src.models.user import User
from src.schemas.review import (
    ChecklistResult,
    ComparisonResult,
    EditEvaluation,
    FixSuggestion,
    KeyInfoItem,
    ReferenceFinding,
    ReferenceResult,
    ReviewConfig,
    ReviewReport,
    RiskBreakdownItem,
)
from src.services.document_permission import DocumentPermissionService
from src.domain.review.review_export import build_legal_eval_html
from src.domain.review.review_helpers import (
    _KEY_INFO_GROUPS,
    _MAX_DOC_CHARS,
    _RISK_IMPACT,
    _build_highlights,
    _build_review_prompt,
    _calculate_formula_score,
    _clamp_score,
    _clean_edit_text,
    _detect_bilingual,
    _dict_list,
    _edits_from_report,
    _extract_text,
    _find_best_verbatim_match,
    _find_clause_label,
    _normalize_ws,
    _parse_edit_type,
    _safe_json_loads,
    _slugify,
    _str_list,
    _SYSTEM_REVIEW_PROMPT,
    _verbatim_confidence,
)
from src.services.storage import get_storage_backend

_log = logging.getLogger(__name__)

async def _read_document_bytes(
    db: AsyncSession,
    document_id: str,
    current_user: User,
) -> tuple[str, bytes]:
    """Đọc (filename, raw_bytes) từ storage backend."""
    try:
        doc_uuid = uuid.UUID(document_id)
    except (ValueError, AttributeError):
        raise HTTPException(400, f"Invalid document_id: {document_id}")
    await DocumentPermissionService(db).check_permission(
        current_user, document_id=doc_uuid, required="viewer"
    )
    doc = await db.get(Document, doc_uuid)
    if not doc or doc.deleted_at is not None:
        raise HTTPException(404, "Document not found")

    from src.models.storage import StorageConfig

    storage_cfg = await db.get(StorageConfig, doc.storage_config_id)
    if not storage_cfg:
        raise HTTPException(500, "Storage config not found")

    backend = get_storage_backend(storage_cfg)
    doc_bytes = await backend.read(doc.file_path)
    return doc.original_filename, doc_bytes


async def _read_document_text(
    db: AsyncSession,
    document_id: str,
    current_user: User,
) -> tuple[str, str]:
    """Đọc (filename, extracted_text) — chạy extract trong thread pool."""
    filename, doc_bytes = await _read_document_bytes(db, document_id, current_user)
    # _extract_text gọi blocking I/O (httpx.post Gotenberg, fitz CPU work)
    # → run trong thread pool để không block async event loop
    text = await asyncio.to_thread(_extract_text, doc_bytes, filename)
    return filename, text


# ─── Step 5: LLM prompt builder ──────────────────────────────────────────────
#
# Prompt design principles:
# - Dùng <untrusted_data> tags bao quanh nội dung người dùng → LLM không treat
#   chúng như instructions (tránh prompt injection)
# - [CLAUSE_NUMBERING_MAP]: reference-only outline với số thứ tự điều khoản
# - [BILINGUAL DOCUMENT]: khi detect bilingual, yêu cầu LLM output đồng thời
#   cả 6 fields VN+EN cho mỗi edit
# - Schema JSON tường minh để LLM output parse được ngay




async def _call_llm(prompt: str, db: AsyncSession) -> dict:
    """Gọi LLM với system prompt review, trả về parsed JSON dict.

    Phase 4 T5: qua AIGateway (điểm vào duy nhất). complete() force stream=False;
    overrides temperature=0/seed=42 giữ tính DETERMINISTIC của chấm điểm review (C1).
    """
    from src.ai import AIGateway

    response = await AIGateway(db).complete(
        [
            {"role": "system", "content": _SYSTEM_REVIEW_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0,
        seed=42,
    )
    return _safe_json_loads(response.choices[0].message.content or "")


# ─── Step 7: Risk scoring ─────────────────────────────────────────────────────
#
# Công thức blend formula + AI score:
#   formula_risk = checklist_risk * 0.5 + edit_risk * 0.5 + missing_contrib + errors_contrib
#   blended = formula_risk * 0.70 + ai_score * 0.30 (khi có signals khách quan)
#
# Proportional accumulation (không linear):
#   mỗi item chiếm rate% headroom còn lại → N vấn đề nhỏ không bao giờ bằng 1 vấn đề lớn




async def _run_review(
    db: AsyncSession,
    job_id: str,
    doc_name: str,
    doc_text: str,
    config: ReviewConfig,
    checklist_labels: list[tuple[str, str]],
    template_text: str | None,
    doc_revisions: list[dict] | None = None,
    template_revisions: list[dict] | None = None,
    reference_texts: list[tuple[str, str]] | None = None,
    doc_outline: str | None = None,
    template_outline: str | None = None,
) -> ReviewReport:
    # 10.1 Truncation warning (LLM context limit)
    # Strategy: keep 2/3 head + 1/3 tail — contract clauses (penalty, termination, signatures)
    # often appear at the end; cutting only from head avoids missing critical sections.
    truncation_warning: str | None = None
    if len(doc_text) > _MAX_DOC_CHARS:
        _head = _MAX_DOC_CHARS * 2 // 3
        _tail = _MAX_DOC_CHARS - _head
        truncation_warning = (
            f"Tài liệu dài {len(doc_text):,} ký tự đã được cắt ngắn còn {_MAX_DOC_CHARS:,} ký tự "
            f"(giữ {_head:,} ký tự đầu + {_tail:,} ký tự cuối). "
            "Nội dung ở giữa tài liệu có thể chưa được đánh giá đầy đủ."
        )
        doc_text = (
            doc_text[:_head]
            + "\n\n…[nội dung giữa đã lược bỏ để vừa giới hạn phân tích]…\n\n"
            + doc_text[-_tail:]
        )

    # 10.2 Identical check (skip template comparison khi 2 doc giống hệt nhau)
    is_identical = False
    if template_text:
        if " ".join(doc_text.split()) == " ".join(template_text.split()):
            is_identical = True

    # 10.3 Bilingual detection
    is_bilingual = _detect_bilingual(doc_text)

    # 10.4 Build prompt + call LLM
    prompt = _build_review_prompt(
        doc_text,
        config,
        checklist_labels,
        None if is_identical else template_text,
        doc_revisions=doc_revisions,
        template_revisions=template_revisions,
        additional_requirements=config.additional_requirements,
        reference_texts=reference_texts,
        reference_content=config.reference_content,
        is_bilingual=is_bilingual,
        has_reference=bool(reference_texts),
        doc_outline=doc_outline,
        template_outline=None if is_identical else template_outline,
    )
    data = await _call_llm(prompt, db)

    # 10.5 Parse checklist — mỗi id từ checklist_labels phải có trong response;
    #      nếu AI bỏ qua, tạo fallback với ai_evaluated=False
    checklist_results: list[ChecklistResult] = []
    returned_checklist = {
        c.get("id"): c for c in data.get("checklist", []) if c.get("id")
    }
    _VALID_CL_STATUS = {"pass", "warning", "risk"}
    for cid, label in checklist_labels:
        item = returned_checklist.get(cid, {})
        ai_evaluated = cid in returned_checklist
        raw_status = item.get("status", "")
        passed = bool(item.get("passed", False))
        resolved_status = (
            raw_status if raw_status in _VALID_CL_STATUS
            else ("pass" if passed else "risk")
        )
        checklist_results.append(
            ChecklistResult(
                id=cid,
                label=item.get("label") or label,
                passed=resolved_status == "pass",
                anchorKeyword=item.get("anchorKeyword") or None,
                status=resolved_status,
                note=item.get("note") or None,
                ai_evaluated=ai_evaluated,
            )
        )

    key_issues: list[str] = [str(i) for i in data.get("keyIssues", []) if i]
    missing_items: list[str] = [str(i) for i in data.get("missingItems", []) if i]

    # 10.6 Parse fixes (issueIndex phải trỏ đến keyIssues hợp lệ)
    fixes: list[FixSuggestion] = []
    for f in data.get("fixes", []):
        try:
            idx = int(f.get("issueIndex", -1))
        except (TypeError, ValueError):
            continue
        if 0 <= idx < len(key_issues):
            fixes.append(FixSuggestion(issueIndex=idx, suggestion=str(f.get("suggestion", ""))))

    # 10.7 Parse edits với verbatim validation
    #      - Discard edit nếu modified_text không match trong doc_text
    #      - Bilingual: discard toàn bộ edit nếu thiếu EN counterpart
    comparison: ComparisonResult | None = None
    if template_text and is_identical:
        comparison = ComparisonResult(
            is_identical=True, differences=[], missingClauses=[], conflictTerms=[], edits=[]
        )
    elif cmp := data.get("comparison"):
        _edits: list[EditEvaluation] = []
        for i, e in enumerate(cmp.get("edits", []) or []):
            verdict = e.get("verdict", "disagree")
            if verdict not in ("agree", "disagree"):
                verdict = "disagree"
            risk = e.get("risk_level", "medium")
            if risk not in ("high", "medium", "low"):
                risk = "medium"
            cat = e.get("suggestion_category", "")
            if cat not in ("improve", "reduce", "rewrite"):
                cat = "rewrite" if risk == "high" else "reduce" if risk == "medium" else "improve"
            modified = _clean_edit_text(str(e.get("modified_text", "")))
            if not modified:
                continue
            # Verbatim check với fuzzy recovery
            verbatim_ok, matched_text = _find_best_verbatim_match(modified, doc_text)
            if not verbatim_ok:
                continue
            modified = matched_text
            anchor_text = _clean_edit_text(matched_text[:40])

            # Confidence: exact match → high; fuzzy 80-95% → medium
            edit_confidence = _verbatim_confidence(modified, doc_text)

            # Đối chiếu với outline để tự động lấy số điều khoản chính xác
            resolved_label = _find_clause_label(matched_text, doc_outline)
            clause_name = resolved_label if resolved_label else str(e.get("clause_name", ""))

            bilingual_anchor = _clean_edit_text(str(e.get("bilingual_anchor_text", ""))) or None
            bilingual_modified = _clean_edit_text(str(e.get("bilingual_modified_text", ""))) or None
            bilingual_suggested = str(e.get("bilingual_suggested_text", "")).strip() or None

            if is_bilingual:
                # Bilingual: bắt buộc có đủ EN counterpart — thiếu → discard
                if not bilingual_modified or not bilingual_suggested:
                    continue
                # Fuzzy match cho bilingual EN text
                b_verbatim_ok, b_matched = _find_best_verbatim_match(bilingual_modified, doc_text)
                if not b_verbatim_ok:
                    continue
                bilingual_modified = b_matched
                bilingual_anchor = _clean_edit_text(b_matched[:40])

            _edits.append(
                EditEvaluation(
                    id=str(e.get("id") or f"e{i + 1}"),
                    clause_name=clause_name,
                    original_text=str(e.get("original_text", "")),
                    modified_text=modified,
                    anchor_text=anchor_text,
                    verdict=verdict,
                    reason=str(e.get("reason", "")),
                    suggested_text=str(e.get("suggested_text", "")),
                    risk_level=risk,
                    suggestion_category=cat,
                    score_impact=_RISK_IMPACT.get(risk, 8),
                    verbatim_match=True,
                    confidence=edit_confidence,
                    edit_type=_parse_edit_type(str(e.get("edit_type", "other"))),
                    bilingual_anchor_text=bilingual_anchor,
                    bilingual_modified_text=bilingual_modified,
                    bilingual_suggested_text=bilingual_suggested,
                )
            )
        comparison = ComparisonResult(
            is_identical=bool(cmp.get("is_identical", False)),
            differences=[str(x) for x in cmp.get("differences", [])] if template_text else [],
            missingClauses=[str(x) for x in cmp.get("missingClauses", [])] if template_text else [],
            conflictTerms=[str(x) for x in cmp.get("conflictTerms", [])] if template_text else [],
            edits=_edits,
        )

    # 10.8 Parse keyInformation — chuẩn hóa về 10 groups cố định, đúng thứ tự
    raw_key_info = data.get("keyInformation") or []
    ki_by_group: dict[str, str | None] = {}
    for ki in raw_key_info:
        if isinstance(ki, dict) and ki.get("group"):
            v = ki.get("value")
            ki_by_group[ki["group"]] = str(v) if v else None
    key_information: list[KeyInfoItem] = [
        KeyInfoItem(group=g, value=ki_by_group.get(g)) for g in _KEY_INFO_GROUPS
    ]

    detected_errors: list[str] = [str(e) for e in (data.get("detectedErrors") or []) if e]
    risk_factors: list[str] = [str(f) for f in (data.get("riskFactors") or []) if f]

    risk_breakdown: list[RiskBreakdownItem] = []
    for rb in (data.get("riskBreakdown") or []):
        if isinstance(rb, dict) and rb.get("category"):
            risk_breakdown.append(
                RiskBreakdownItem(
                    category=str(rb["category"]),
                    score=_clamp_score(rb.get("score", 50)),
                    issues=[str(iss) for iss in (rb.get("issues") or []) if iss],
                )
            )

    reference_results: list[ReferenceResult] = []
    for rr in (data.get("referenceResults") or []):
        if not isinstance(rr, dict) or not rr.get("reference_name"):
            continue
        parsed_findings: list[ReferenceFinding] = []
        for f in (rr.get("findings") or []):
            if isinstance(f, dict):
                text = str(f.get("text") or f.get("finding") or "").strip()
                anchor = str(f.get("anchorKeyword") or "").strip() or None
                suggested = str(f.get("suggested_text") or "").strip() or None
                violated = str(f.get("violated_rule") or "").strip() or None
                if text:
                    parsed_findings.append(ReferenceFinding(
                        text=text,
                        anchorKeyword=anchor,
                        suggested_text=suggested,
                        violated_rule=violated,
                    ))
            elif isinstance(f, str) and f.strip():
                parsed_findings.append(ReferenceFinding(text=f.strip(), anchorKeyword=None))
        reference_results.append(
            ReferenceResult(reference_name=str(rr["reference_name"]), findings=parsed_findings)
        )

    # 10.8b Convert reference findings with suggested_text → EditEvaluation
    # Allows FE to highlight and apply reference-compliance fixes same as regular edits.
    ref_edits_to_add: list[EditEvaluation] = []
    if reference_results and comparison is not None:
        existing_anchors = {
            _normalize_ws(e.anchor_text or e.modified_text[:40])
            for e in comparison.edits
        }
        for rr_idx, rr in enumerate(reference_results):
            for f_idx, f in enumerate(rr.findings):
                if not f.suggested_text or not f.anchorKeyword:
                    continue
                anchor_norm = _normalize_ws(f.anchorKeyword)
                if anchor_norm in existing_anchors:
                    continue  # skip — already covered in comparison.edits
                verbatim_ok, matched = _find_best_verbatim_match(f.anchorKeyword, doc_text)
                if not verbatim_ok:
                    continue
                existing_anchors.add(_normalize_ws(matched[:40]))
                ref_edits_to_add.append(EditEvaluation(
                    id=f"ref_{rr_idx}_{f_idx}",
                    clause_name=f.violated_rule or rr.reference_name,
                    original_text="",
                    modified_text=matched,
                    anchor_text=_clean_edit_text(matched[:40]),
                    verdict="disagree",
                    reason=f.text + (f" (vi phạm: {f.violated_rule})" if f.violated_rule else ""),
                    suggested_text=f.suggested_text,
                    risk_level="high",
                    suggestion_category="rewrite",
                    score_impact=_RISK_IMPACT["high"],
                    verbatim_match=True,
                    confidence=_verbatim_confidence(matched, doc_text),
                    edit_type="inconsistency",
                ))
        if ref_edits_to_add:
            comparison = ComparisonResult(
                is_identical=comparison.is_identical,
                differences=comparison.differences,
                missingClauses=comparison.missingClauses,
                conflictTerms=comparison.conflictTerms,
                edits=ref_edits_to_add + comparison.edits,
            )
    elif reference_results and comparison is None:
        # No compare mode but reference mode — create comparison to hold ref edits
        ref_edits_to_add = []
        for rr_idx, rr in enumerate(reference_results):
            for f_idx, f in enumerate(rr.findings):
                if not f.suggested_text or not f.anchorKeyword:
                    continue
                verbatim_ok, matched = _find_best_verbatim_match(f.anchorKeyword, doc_text)
                if not verbatim_ok:
                    continue
                ref_edits_to_add.append(EditEvaluation(
                    id=f"ref_{rr_idx}_{f_idx}",
                    clause_name=f.violated_rule or rr.reference_name,
                    original_text="",
                    modified_text=matched,
                    anchor_text=_clean_edit_text(matched[:40]),
                    verdict="disagree",
                    reason=f.text + (f" (vi phạm: {f.violated_rule})" if f.violated_rule else ""),
                    suggested_text=f.suggested_text,
                    risk_level="high",
                    suggestion_category="rewrite",
                    score_impact=_RISK_IMPACT["high"],
                    verbatim_match=True,
                    confidence=_verbatim_confidence(matched, doc_text),
                    edit_type="inconsistency",
                ))
        if ref_edits_to_add:
            comparison = ComparisonResult(
                is_identical=False,
                differences=[],
                missingClauses=[],
                conflictTerms=[],
                edits=ref_edits_to_add,
            )

    # 10.9 Calculate blended risk score
    all_edits = comparison.edits if comparison else []
    ai_score = _clamp_score(data.get("riskScore", 50))
    blended_score = _calculate_formula_score(
        checklist_results, all_edits, ai_score,
        missing_items=missing_items,
        detected_errors=detected_errors,
    )

    # 10.10 Build highlights
    highlights = _build_highlights(
        edits=all_edits,
        checklist_results=checklist_results,
        has_compare=bool(template_text),
        has_reference=bool(reference_texts),
        reference_results=reference_results or None,
    )

    is_bilingual_result = bool(data.get("is_bilingual", False)) or is_bilingual

    return ReviewReport(
        job_id=job_id,
        document_name=doc_name,
        review_type=config.review_type,
        created_at=datetime.utcnow().isoformat(),
        summary=str(data.get("summary", "")),
        riskExplanation=str(data.get("riskExplanation", "")),
        keyIssues=key_issues,
        missingItems=missing_items,
        suggestions=[str(i) for i in data.get("suggestions", []) if i],
        checklist=checklist_results,
        riskScore=blended_score,
        highlights=highlights,
        fixes=fixes,
        comparison=comparison,
        keyInformation=key_information,
        detectedErrors=detected_errors,
        truncation_warning=truncation_warning,
        riskFactors=risk_factors,
        riskBreakdown=risk_breakdown,
        referenceResults=reference_results,
        is_bilingual=is_bilingual_result,
    )


# ─── Checklist label catalog ──────────────────────────────────────────────────



async def _load_job(db: AsyncSession, job_id: str, user_id: uuid.UUID) -> ReviewJob:
    try:
        job_uuid = uuid.UUID(job_id)
    except (ValueError, AttributeError):
        raise HTTPException(400, f"Invalid job_id: {job_id}")
    stmt = select(ReviewJob).where(
        ReviewJob.id == job_uuid,
        ReviewJob.user_id == user_id,
        ReviewJob.deleted_at.is_(None),
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Review result not found")
    return row


class ReviewService:
    """Facade DB-bound cho review business-logic (giữ session của request/uow)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def read_document_bytes(self, document_id: str, current_user: User) -> tuple[str, bytes]:
        return await _read_document_bytes(self._session, document_id, current_user)

    async def read_document_text(self, document_id: str, current_user: User) -> tuple[str, str]:
        return await _read_document_text(self._session, document_id, current_user)

    async def call_llm(self, prompt: str) -> dict:
        return await _call_llm(prompt, self._session)

    async def run_review(self, *args, **kwargs) -> ReviewReport:
        return await _run_review(self._session, *args, **kwargs)

    async def load_job(self, job_id: str, user_id: uuid.UUID) -> ReviewJob:
        return await _load_job(self._session, job_id, user_id)

    async def persist_eval_pdf(
        self,
        job_id: uuid.UUID,
        *,
        pdf_bytes: bytes | None = None,
        applied_edits: dict | None = None,
        version_label: str | None = None,
    ) -> None:
        """Store eval-report PDF và gắn vào job (best-effort).

        Phase 8 B3 — sửa latent bug session-reuse: nhận `job_id` (KHÔNG ORM object gắn
        session khác), đọc lại ReviewJob trong self._session. **KHÔNG tự commit, KHÔNG
        nuốt exception** — CALLER bọc `async with uow_context() as uow:` (session RIÊNG,
        commit/rollback boundary) + try/except NGOÀI cho best-effort/log. Nhờ vậy cả
        background task (start_review) lẫn download path KHÔNG poison/đụng request session.
        Skip GRACEFUL (return) khi thiếu gotenberg/cfg/job — đó KHÔNG phải lỗi.

        Nếu pdf_bytes được cung cấp → lưu trực tiếp, không gọi Gotenberg.
        Nếu không → tự generate HTML → Gotenberg → lưu (pre-generate path).
        """
        db = self._session
        settings = get_settings()
        if pdf_bytes is None and not settings.gotenberg_url:
            return
        job_row = await db.get(ReviewJob, job_id)
        if job_row is None:
            return

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
                    "persist_eval_pdf: Gotenberg returned %s for job %s", resp.status_code, job_row.id
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
        # KHÔNG commit ở đây — uow_context của caller sở hữu boundary (commit khi sạch /
        # rollback khi lỗi). KHÔNG try/except nuốt — để exception lan tới uow + caller.
        _log.info("persist_eval_pdf: stored PDF %s for job %s", pdf_doc.id, job_row.id)
