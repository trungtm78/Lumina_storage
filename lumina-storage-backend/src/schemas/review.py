"""Schema Pydantic cho Document Review & Analysis.

Phase 8 (slice B0): tách khỏi route `api/v1/routes/review.py` để `ReviewService`
(src.services) dùng được mà KHÔNG vi phạm import-linter "Services must not import api"
(ReviewService khởi tạo các model này lúc runtime). Schema khớp FE
`src/app/api/endpoints/review.ts`.
"""
from typing import Literal

from pydantic import BaseModel, Field

# ─── Literal types ────────────────────────────────────────────────────────────

ReviewType = Literal["Legal", "Business", "Financial", "Admin", "Compliance", "Custom"]
DocSource = Literal["drive", "upload", "url"]
TemplateSource = Literal["drive", "upload"]
HighlightSeverity = Literal["pass", "warning", "risk"]
SeverityLabel = Literal["low", "medium", "high"]
HighlightType = Literal["analysis", "compare", "reference"]
QuickActionType = Literal["improve", "optimize", "reduce"]


# ─── Request / Response Models ────────────────────────────────────────────────

class ReviewConfig(BaseModel):
    document_id: str
    doc_source: DocSource = "drive"
    source_url: str | None = None
    review_type: ReviewType
    checklist_item_ids: list[str] = []
    compare_enabled: bool = False
    compare_document_ids: list[str] = []
    template_source: TemplateSource | None = None
    additional_requirements: str | None = None
    reference_enabled: bool = False
    reference_doc_ids: list[str] = []
    reference_content: str | None = None


class ChecklistResult(BaseModel):
    id: str
    label: str
    passed: bool
    anchorKeyword: str | None = None
    status: str | None = None
    note: str | None = None
    ai_evaluated: bool = True


class DocHighlight(BaseModel):
    keyword: str
    severity: HighlightSeverity
    tooltip: str
    severity_label: SeverityLabel
    highlight_type: HighlightType = "analysis"
    ref_id: str | None = None
    bilingual_keyword: str | None = None


class ReferenceFinding(BaseModel):
    text: str
    anchorKeyword: str | None = None
    suggested_text: str | None = None
    violated_rule: str | None = None


class ReferenceResult(BaseModel):
    reference_name: str
    findings: list[ReferenceFinding] = Field(default_factory=list)


class FixSuggestion(BaseModel):
    issueIndex: int
    suggestion: str


class EditEvaluation(BaseModel):
    """Per-edit evaluation — verbatim anchor in main doc + AI-generated replacement."""

    id: str
    clause_name: str
    original_text: str
    modified_text: str
    anchor_text: str = ""
    verdict: Literal["agree", "disagree"]
    reason: str
    suggested_text: str = ""
    risk_level: Literal["high", "medium", "low"]
    suggestion_category: Literal["improve", "reduce", "rewrite"] = "improve"
    score_impact: int = 0
    verbatim_match: bool = True
    # confidence: how closely modified_text matched doc verbatim (high=exact, medium=fuzzy)
    confidence: Literal["high", "medium"] = "medium"
    # edit_type: nature of the issue driving this edit
    edit_type: Literal["unfavorable_term", "missing_clause", "ambiguous", "inconsistency", "error", "other"] = "other"
    bilingual_anchor_text: str | None = None
    bilingual_modified_text: str | None = None
    bilingual_suggested_text: str | None = None
    is_quick_action: bool = False


class ComparisonResult(BaseModel):
    is_identical: bool = False
    differences: list[str] = Field(default_factory=list)
    missingClauses: list[str] = Field(default_factory=list)
    conflictTerms: list[str] = Field(default_factory=list)
    edits: list[EditEvaluation] = Field(default_factory=list)


class KeyInfoItem(BaseModel):
    group: str
    value: str | None = None


class RiskBreakdownItem(BaseModel):
    category: str
    score: int
    issues: list[str] = Field(default_factory=list)


class ReviewReport(BaseModel):
    job_id: str
    document_name: str
    review_type: ReviewType
    created_at: str
    summary: str
    riskExplanation: str
    keyIssues: list[str]
    missingItems: list[str]
    suggestions: list[str]
    checklist: list[ChecklistResult]
    riskScore: int
    highlights: list[DocHighlight]
    fixes: list[FixSuggestion]
    comparison: ComparisonResult | None = None
    keyInformation: list[KeyInfoItem] = Field(default_factory=list)
    detectedErrors: list[str] = Field(default_factory=list)
    riskFactors: list[str] = Field(default_factory=list)
    riskBreakdown: list[RiskBreakdownItem] = Field(default_factory=list)
    referenceResults: list[ReferenceResult] = Field(default_factory=list)
    sessionEvents: list[dict] = Field(default_factory=list)
    truncation_warning: str | None = None
    is_bilingual: bool = False


class QuickActionRequest(BaseModel):
    job_id: str
    action_type: QuickActionType
    user_instruction: str | None = None
    additional_requirements: str | None = None


class QuickActionResult(BaseModel):
    type: QuickActionType
    summary: str
    newScore: int
    suggested_edits: list[dict] | None = None


class SaveVersionRequest(BaseModel):
    version_num: int
    label: str
    type: str
    score: int
    review_type: str | None = None
    result: dict
    applied_edits: dict | None = None


class VersionResponse(BaseModel):
    id: str
    version_num: int
    label: str
    type: str
    score: int
    review_type: str | None = None
    result: dict
    created_at: str
    applied_edits: dict | None = None


class RecalculateScoreRequest(BaseModel):
    applied_edits: dict
    # Danh sách quick-action edits mới cần merge vào comparison.edits của report.
    # FE gửi kèm khi user apply quick-action edits để BE persist chúng vào DB.
    quick_action_edits: list[dict] | None = None


class UpdateStatusRequest(BaseModel):
    status: Literal["reviewing", "completed"]


class SessionEventData(BaseModel):
    id: str
    type: str
    label: str
    timestamp: str


class SaveSessionEventsRequest(BaseModel):
    events: list[SessionEventData]


class SuggestChecklistRequest(BaseModel):
    document_id: str
    review_type: ReviewType


class SuggestChecklistResponse(BaseModel):
    suggested_ids: list[str]
