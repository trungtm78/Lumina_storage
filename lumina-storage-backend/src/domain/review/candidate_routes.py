"""REST API endpoints for Candidate Evaluation (No-Prompt UI).

These endpoints call skill tool scripts directly, bypassing the agent.
The frontend orchestrates the multi-step workflow.
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import CurrentUser
from src.core.config import Settings, get_settings
from src.core.database import get_db
from src.services.skill_service import SkillContext, SkillService

router = APIRouter(prefix="/candidate-evaluation", tags=["candidate-evaluation"])


# ── Request limits ───────────────────────────────────────────────────────────
# Guard against DoS (attacker submitting 1000 doc_ids) and LLM token-budget
# blowouts (very large candidate lists blow past context windows mid-batch).
MAX_CVS_PER_REQUEST = 50
MAX_CANDIDATES_FOR_MATCH = 100
MAX_CANDIDATES_FOR_QUESTIONS = 20
MAX_CANDIDATES_IN_REPORT = 100


# ── Request / Response schemas ───────────────────────────────────────────────


class ParseJDRequest(BaseModel):
    document_id: uuid.UUID
    model_id: uuid.UUID | None = None


class ParseJDResponse(BaseModel):
    jd: dict
    jd_summary: str
    jd_filename: str
    jd_document_id: str


class ParseCVsRequest(BaseModel):
    document_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=MAX_CVS_PER_REQUEST)
    jd: dict = Field(default_factory=dict)  # optional for master-list flow (no JD context needed)
    jd_document_id: str = ""
    existing_candidates: list[dict] = Field(default_factory=list, max_length=MAX_CVS_PER_REQUEST * 4)
    model_id: uuid.UUID | None = None


class ParseCVsResponse(BaseModel):
    candidates_count: int
    new_parsed: int
    failed_count: int = 0
    failed_document_ids: list[str] | None = None
    errors: list[str] | None = None
    candidates_summary: str
    candidates: list[dict]


class MatchRequest(BaseModel):
    jd: dict
    candidates: list[dict] = Field(..., min_length=1, max_length=MAX_CANDIDATES_FOR_MATCH)
    top_n: int = Field(5, ge=1, le=50)
    model_id: uuid.UUID | None = None


class MatchResponse(BaseModel):
    shortlist_count: int
    total_evaluated: int
    rankings_summary: str
    rankings: list[dict]
    shortlist_indices: list[int]


class GenerateQuestionsRequest(BaseModel):
    jd: dict
    candidates: list[dict] = Field(..., min_length=1, max_length=MAX_CANDIDATES_FOR_MATCH)
    rankings: list[dict] = Field(default_factory=list, max_length=MAX_CANDIDATES_FOR_MATCH)
    shortlist_indices: list[int] = Field(default_factory=list, max_length=MAX_CANDIDATES_FOR_QUESTIONS)
    candidate_indices: list[int] | None = Field(None, max_length=MAX_CANDIDATES_FOR_QUESTIONS)
    model_id: uuid.UUID | None = None


class GenerateQuestionsResponse(BaseModel):
    questions_count: int
    candidates_count: int
    questions_summary: str
    candidate_questions: list[dict]
    interview_questions: dict  # indexed by candidate_index string


class GenerateReportRequest(BaseModel):
    jd: dict
    candidates: list[dict] = Field(..., min_length=1, max_length=MAX_CANDIDATES_IN_REPORT)
    rankings: list[dict] = Field(..., min_length=1, max_length=MAX_CANDIDATES_IN_REPORT)
    interview_questions: dict = Field(default_factory=dict)
    jd_document_id: str
    top_n: int = Field(5, ge=1, le=50)
    model_id: uuid.UUID | None = None


class GenerateReportResponse(BaseModel):
    rendered_document_id: str
    preview_pdf_id: str
    summary: str


# ── Scan to Master List schemas ───────────────────────────────────────────────

_EXTRACTED_FIELDS = Literal[
    "name", "email", "phone", "location",
    "current_role", "current_company", "experience_years",
    "career_level", "hard_skills", "soft_skills", "skills",
    "education", "certifications", "languages", "summary",
]

MAX_CVS_PER_SCAN = 50


class ColumnMappingItem(BaseModel):
    extracted_field: _EXTRACTED_FIELDS
    target_column: str = Field(..., min_length=1, max_length=200)


class ScanToMasterListRequest(BaseModel):
    document_ids: list[uuid.UUID] = Field(..., min_length=1, max_length=MAX_CVS_PER_SCAN)
    master_list_document_id: uuid.UUID | None = None  # None = create new file
    column_mapping: list[ColumnMappingItem] = Field(..., min_length=1, max_length=50)
    model_id: uuid.UUID | None = None


class ImportLogEntry(BaseModel):
    candidate_name: str
    document_id: str
    status: Literal["success", "failed", "needs_review"]
    row_number: int | None = None
    message: str | None = None


class ScanToMasterListResponse(BaseModel):
    output_document_id: str
    success_count: int
    failed_count: int
    needs_review_count: int
    import_log: list[ImportLogEntry]


class ReadMasterListHeadersRequest(BaseModel):
    master_list_document_id: uuid.UUID


class ReadMasterListHeadersResponse(BaseModel):
    columns: list[str]
    sheet_name: str


# ── Helpers ──────────────────────────────────────────────────────────────────


async def _build_ctx(
    db: AsyncSession, settings: Settings, user, model_id: uuid.UUID | None = None,
) -> SkillContext:
    """Build SkillContext, optionally resolving user-selected model."""
    svc = SkillService(settings)
    model_str, api_key, api_base, api_version, _ = await svc.resolve_model(
        db, settings, model_id,
    )
    return SkillContext(
        db=db,
        settings=settings,
        user=user,
        model_override=model_str,
        model_api_key=api_key,
        model_api_base=api_base,
        model_api_version=api_version,
    )


def _get_skill(settings: Settings):
    svc = SkillService(settings)
    skill = svc.get_by_name("candidate-evaluation")
    if not skill:
        raise RuntimeError("candidate-evaluation skill not found")
    return svc, skill


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.post("/parse-jd", response_model=ParseJDResponse)
async def parse_jd(
    body: ParseJDRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Parse a Job Description document into structured data."""
    ctx = await _build_ctx(db, settings, current_user, body.model_id)
    svc, skill = _get_skill(settings)

    result = await svc.run_tool(skill, "parse_jd", {
        "document_ids": [str(body.document_id)],
    }, ctx)

    if result.get("error"):
        from src.core.exceptions import BadRequestError
        raise BadRequestError(result["error"])

    return ParseJDResponse(
        jd=result["jd"],
        jd_summary=result["jd_summary"],
        jd_filename=result["jd_filename"],
        jd_document_id=str(body.document_id),
    )


@router.post("/parse-cvs", response_model=ParseCVsResponse)
async def parse_cvs(
    body: ParseCVsRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Parse multiple CV documents, extracting candidate info."""
    ctx = await _build_ctx(db, settings, current_user, body.model_id)
    svc, skill = _get_skill(settings)

    result = await svc.run_tool(skill, "parse_cvs", {
        "document_ids": [str(d) for d in body.document_ids],
        "_state": {
            "jd": body.jd,
            "jd_document_id": body.jd_document_id,
            "candidates": body.existing_candidates,
        },
    }, ctx)

    if result.get("error"):
        from src.core.exceptions import BadRequestError
        raise BadRequestError(result["error"])

    return ParseCVsResponse(
        candidates_count=result["candidates_count"],
        new_parsed=result.get("new_parsed", 0),
        failed_count=result.get("failed_count", 0),
        failed_document_ids=result.get("failed_document_ids"),
        errors=result.get("errors"),
        candidates_summary=result["candidates_summary"],
        candidates=result["candidates"],
    )


@router.post("/match", response_model=MatchResponse)
async def match_candidates(
    body: MatchRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Score and rank candidates against the JD."""
    ctx = await _build_ctx(db, settings, current_user, body.model_id)
    svc, skill = _get_skill(settings)

    result = await svc.run_tool(skill, "match_candidates", {
        "top_n": body.top_n,
        "_state": {
            "jd": body.jd,
            "candidates": body.candidates,
        },
    }, ctx)

    if result.get("error"):
        from src.core.exceptions import BadRequestError
        raise BadRequestError(result["error"])

    state = result.get("_state", {})
    return MatchResponse(
        shortlist_count=result["shortlist_count"],
        total_evaluated=result["total_evaluated"],
        rankings_summary=result["rankings_summary"],
        rankings=result["rankings"],
        shortlist_indices=state.get("shortlist_indices", []),
    )


@router.post("/generate-questions", response_model=GenerateQuestionsResponse)
async def generate_questions(
    body: GenerateQuestionsRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Generate tailored interview questions for candidates."""
    ctx = await _build_ctx(db, settings, current_user, body.model_id)
    svc, skill = _get_skill(settings)

    result = await svc.run_tool(skill, "generate_questions", {
        "candidate_indices": body.candidate_indices,
        "_state": {
            "jd": body.jd,
            "candidates": body.candidates,
            "rankings": body.rankings,
            "shortlist_indices": body.shortlist_indices,
        },
    }, ctx)

    if result.get("error"):
        from src.core.exceptions import BadRequestError
        raise BadRequestError(result["error"])

    state = result.get("_state", {})
    return GenerateQuestionsResponse(
        questions_count=result["questions_count"],
        candidates_count=result["candidates_count"],
        questions_summary=result["questions_summary"],
        candidate_questions=result["candidate_questions"],
        interview_questions=state.get("interview_questions", {}),
    )


@router.post("/generate-report", response_model=GenerateReportResponse)
async def generate_report(
    body: GenerateReportRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Generate PDF evaluation report."""
    ctx = await _build_ctx(db, settings, current_user, body.model_id)
    svc, skill = _get_skill(settings)

    result = await svc.run_tool(skill, "generate_report", {
        "document_ids": [body.jd_document_id],
        "_state": {
            "jd": body.jd,
            "candidates": body.candidates,
            "rankings": body.rankings,
            "interview_questions": body.interview_questions,
            "jd_document_id": body.jd_document_id,
            "top_n": body.top_n,
        },
    }, ctx)

    if result.get("error"):
        from src.core.exceptions import BadRequestError
        raise BadRequestError(result["error"])

    return GenerateReportResponse(
        rendered_document_id=result["rendered_document_id"],
        preview_pdf_id=result["preview_pdf_id"],
        summary=result["summary"],
    )


@router.post("/read-master-list-headers", response_model=ReadMasterListHeadersResponse)
async def read_master_list_headers(
    body: ReadMasterListHeadersRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Read column headers from an existing Master List Excel file."""
    ctx = await _build_ctx(db, settings, current_user)
    svc, skill = _get_skill(settings)

    result = await svc.run_tool(skill, "scan_to_master_list", {
        "action": "read_headers",
        "master_list_document_id": str(body.master_list_document_id),
    }, ctx)

    if result.get("error"):
        from src.core.exceptions import BadRequestError
        raise BadRequestError(result["error"])

    return ReadMasterListHeadersResponse(
        columns=result["columns"],
        sheet_name=result["sheet_name"],
    )


@router.post("/scan-to-master-list", response_model=ScanToMasterListResponse)
async def scan_to_master_list(
    body: ScanToMasterListRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Parse batch CVs and append structured candidate data into a Master List Excel."""
    ctx = await _build_ctx(db, settings, current_user, body.model_id)
    svc, skill = _get_skill(settings)

    result = await svc.run_tool(skill, "scan_to_master_list", {
        "action": "import",
        "document_ids": [str(d) for d in body.document_ids],
        "master_list_document_id": str(body.master_list_document_id) if body.master_list_document_id else None,
        "column_mapping": [m.model_dump() for m in body.column_mapping],
    }, ctx)

    if result.get("error"):
        from src.core.exceptions import BadRequestError
        raise BadRequestError(result["error"])

    return ScanToMasterListResponse(
        output_document_id=result["output_document_id"],
        success_count=result["success_count"],
        failed_count=result["failed_count"],
        needs_review_count=result["needs_review_count"],
        import_log=[ImportLogEntry(**entry) for entry in result["import_log"]],
    )
