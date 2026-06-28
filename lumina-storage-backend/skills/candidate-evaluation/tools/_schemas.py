"""Pydantic schemas for LLM output validation in the candidate-evaluation pipeline.

Purpose: guard against LLM hallucinations where required fields are missing or have
wrong types (e.g. `skills: "python"` instead of `["python"]`). Validation is lenient
— missing/invalid fields fall back to safe defaults so downstream code never crashes,
but shape is guaranteed.

Public entry points:
    safe_parse_jd(raw) -> dict
    safe_parse_cv(raw) -> dict
    safe_parse_evaluations(raw) -> list[dict]
    safe_parse_questions(raw) -> list[dict]
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


# ─────────────────────────────────────────────────────────────────────────────
# Coercion helpers — the LLM sometimes emits scalars where lists are expected,
# or vice versa. These helpers normalize without raising so validation succeeds
# with best-effort data.
# ─────────────────────────────────────────────────────────────────────────────


def _as_list(v: Any) -> list:
    if v is None:
        return []
    if isinstance(v, list):
        return v
    if isinstance(v, (str, int, float)):
        return [v] if str(v).strip() else []
    if isinstance(v, dict):
        return [v]
    return []


def _as_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    return str(v)


def _as_float(v: Any, default: float = 0.0) -> float:
    if v is None:
        return default
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).strip())
    except (ValueError, TypeError):
        return default


def _as_dict(v: Any) -> dict:
    return v if isinstance(v, dict) else {}


# ─────────────────────────────────────────────────────────────────────────────
# JD schema
# ─────────────────────────────────────────────────────────────────────────────


class _JDHardSkill(BaseModel):
    model_config = ConfigDict(extra="allow")
    skill: str = ""
    level: str = "any"
    priority: str = "must-have"
    category: str = ""
    group: str | None = None

    @field_validator("skill", "level", "priority", "category", mode="before")
    @classmethod
    def _coerce_str(cls, v):
        return _as_str(v)


class _JDSoftSkill(BaseModel):
    model_config = ConfigDict(extra="allow")
    skill: str = ""
    priority: str = "nice-to-have"

    @field_validator("skill", "priority", mode="before")
    @classmethod
    def _coerce_str(cls, v):
        return _as_str(v)


class _JDExperienceRange(BaseModel):
    model_config = ConfigDict(extra="allow")
    min_years: float | None = None
    max_years: float | None = None
    preferred_years: float | None = None
    note: str = ""

    @field_validator("min_years", "max_years", "preferred_years", mode="before")
    @classmethod
    def _coerce_num(cls, v):
        if v is None or v == "":
            return None
        return _as_float(v, default=None) if v is not None else None

    @field_validator("note", mode="before")
    @classmethod
    def _coerce_note(cls, v):
        return _as_str(v)


class _JDEducation(BaseModel):
    model_config = ConfigDict(extra="allow")
    min_level: str = ""
    preferred_fields: list[str] = Field(default_factory=list)
    note: str = ""

    @field_validator("preferred_fields", mode="before")
    @classmethod
    def _coerce_fields(cls, v):
        return [_as_str(x) for x in _as_list(v) if _as_str(x).strip()]

    @field_validator("min_level", "note", mode="before")
    @classmethod
    def _coerce_str(cls, v):
        return _as_str(v)


class JDSchema(BaseModel):
    """Validated Job Description structure."""

    model_config = ConfigDict(extra="allow")

    job_title: str = "Chưa rõ"
    company: str = "Chưa rõ"
    department: str = ""
    location: str = ""
    work_mode: str = ""
    employment_type: str = ""
    experience_range: _JDExperienceRange = Field(default_factory=_JDExperienceRange)
    internship_duration: str = ""
    hard_skills: list[_JDHardSkill] = Field(default_factory=list)
    soft_skills: list[_JDSoftSkill] = Field(default_factory=list)
    education: _JDEducation = Field(default_factory=_JDEducation)
    certifications_required: list[dict] = Field(default_factory=list)
    languages_required: list[dict] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    benefits: list[str] = Field(default_factory=list)
    culture_keywords: list[str] = Field(default_factory=list)
    summary: str = ""

    @field_validator("hard_skills", mode="before")
    @classmethod
    def _coerce_hard(cls, v):
        out = []
        for item in _as_list(v):
            if isinstance(item, dict):
                out.append(item)
            elif isinstance(item, str) and item.strip():
                out.append({"skill": item})
        return out

    @field_validator("soft_skills", mode="before")
    @classmethod
    def _coerce_soft(cls, v):
        out = []
        for item in _as_list(v):
            if isinstance(item, dict):
                out.append(item)
            elif isinstance(item, str) and item.strip():
                out.append({"skill": item})
        return out

    @field_validator("responsibilities", "benefits", "culture_keywords", mode="before")
    @classmethod
    def _coerce_str_list(cls, v):
        return [_as_str(x) for x in _as_list(v) if _as_str(x).strip()]

    @field_validator("certifications_required", "languages_required", mode="before")
    @classmethod
    def _coerce_dict_list(cls, v):
        out = []
        for item in _as_list(v):
            if isinstance(item, dict):
                out.append(item)
            elif isinstance(item, str) and item.strip():
                out.append({"name": item})
        return out

    @field_validator(
        "job_title", "company", "department", "location",
        "work_mode", "employment_type", "internship_duration", "summary",
        mode="before",
    )
    @classmethod
    def _coerce_str(cls, v):
        return _as_str(v)


# ─────────────────────────────────────────────────────────────────────────────
# CV schema
# ─────────────────────────────────────────────────────────────────────────────


class _CVHardSkill(BaseModel):
    model_config = ConfigDict(extra="allow")
    skill: str = ""
    level: str = ""
    years: float = 0
    category: str = ""

    @field_validator("years", mode="before")
    @classmethod
    def _coerce_years(cls, v):
        return _as_float(v, default=0.0)

    @field_validator("skill", "level", "category", mode="before")
    @classmethod
    def _coerce_str(cls, v):
        return _as_str(v)


class _CVEducation(BaseModel):
    model_config = ConfigDict(extra="allow")
    degree: str = ""
    field: str = ""
    school: str = ""
    year_start: str = ""
    year_end: str = ""
    gpa: str = ""
    honors: str = ""

    @field_validator(
        "degree", "field", "school", "year_start", "year_end", "gpa", "honors",
        mode="before",
    )
    @classmethod
    def _coerce_str(cls, v):
        return _as_str(v)


class _CVExperience(BaseModel):
    model_config = ConfigDict(extra="allow")
    company: str = ""
    role: str = ""
    start: str = ""
    end: str = ""
    duration_months: float = 0
    highlights: list[str] = Field(default_factory=list)
    technologies_used: list[str] = Field(default_factory=list)

    @field_validator("duration_months", mode="before")
    @classmethod
    def _coerce_num(cls, v):
        return _as_float(v, default=0.0)

    @field_validator("highlights", "technologies_used", mode="before")
    @classmethod
    def _coerce_list(cls, v):
        return [_as_str(x) for x in _as_list(v) if _as_str(x).strip()]

    @field_validator("company", "role", "start", "end", mode="before")
    @classmethod
    def _coerce_str(cls, v):
        return _as_str(v)


class _CVProject(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str = ""
    description: str = ""
    role: str = ""
    technologies: list[str] = Field(default_factory=list)

    @field_validator("technologies", mode="before")
    @classmethod
    def _coerce_list(cls, v):
        return [_as_str(x) for x in _as_list(v) if _as_str(x).strip()]

    @field_validator("name", "description", "role", mode="before")
    @classmethod
    def _coerce_str(cls, v):
        return _as_str(v)


class CVSchema(BaseModel):
    """Validated Candidate CV structure."""

    model_config = ConfigDict(extra="allow")

    name: str = ""
    email: str = ""
    phone: str = ""
    location: str = ""
    current_role: str = ""
    current_company: str = ""
    experience_years: float = 0
    career_level: str = "Chưa rõ"
    hard_skills: list[_CVHardSkill] = Field(default_factory=list)
    soft_skills: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    education: list[_CVEducation] = Field(default_factory=list)
    experience: list[_CVExperience] = Field(default_factory=list)
    projects: list[_CVProject] = Field(default_factory=list)
    certifications: list[dict] = Field(default_factory=list)
    languages: list[dict] = Field(default_factory=list)
    summary: str = ""

    @field_validator("experience_years", mode="before")
    @classmethod
    def _coerce_years(cls, v):
        return _as_float(v, default=0.0)

    @field_validator("hard_skills", mode="before")
    @classmethod
    def _coerce_hard(cls, v):
        out = []
        for item in _as_list(v):
            if isinstance(item, dict):
                out.append(item)
            elif isinstance(item, str) and item.strip():
                out.append({"skill": item})
        return out

    @field_validator("soft_skills", "skills", mode="before")
    @classmethod
    def _coerce_str_list(cls, v):
        out = []
        for item in _as_list(v):
            if isinstance(item, dict):
                s = _as_str(item.get("skill") or item.get("name") or "")
                if s.strip():
                    out.append(s)
            elif isinstance(item, str) and item.strip():
                out.append(item)
        return out

    @field_validator("certifications", "languages", mode="before")
    @classmethod
    def _coerce_dict_list(cls, v):
        out = []
        for item in _as_list(v):
            if isinstance(item, dict):
                out.append(item)
            elif isinstance(item, str) and item.strip():
                out.append({"name": item})
        return out

    @field_validator(
        "name", "email", "phone", "location", "current_role", "current_company",
        "career_level", "summary",
        mode="before",
    )
    @classmethod
    def _coerce_str(cls, v):
        return _as_str(v)


# ─────────────────────────────────────────────────────────────────────────────
# Evaluation / scoring schema
# ─────────────────────────────────────────────────────────────────────────────


VALID_SCORE_KEYS = {
    "hard_skills_match",
    "soft_skills_match",
    "nice_to_have",
    "experience_relevance",
    "education_certs",
    "overall_impression",
}


class _ScoreBreakdown(BaseModel):
    model_config = ConfigDict(extra="allow")
    hard_skills_match: float = 0
    soft_skills_match: float = 0
    nice_to_have: float = 0
    experience_relevance: float = 0
    education_certs: float = 0
    overall_impression: float = 0

    @field_validator(
        "hard_skills_match", "soft_skills_match", "nice_to_have",
        "experience_relevance", "education_certs", "overall_impression",
        mode="before",
    )
    @classmethod
    def _coerce_score(cls, v):
        n = _as_float(v, default=0.0)
        return max(0.0, min(100.0, n))


class EvaluationSchema(BaseModel):
    """Validated evaluation/scoring output per candidate."""

    model_config = ConfigDict(extra="allow")

    candidate_index: int = -1
    name: str = ""
    scores: _ScoreBreakdown = Field(default_factory=_ScoreBreakdown)
    total_score: float = 0
    matched_hard_skills: list[str] = Field(default_factory=list)
    missing_hard_skills: list[str] = Field(default_factory=list)
    matched_soft_skills: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    recommendation_note: str = ""

    @field_validator("candidate_index", mode="before")
    @classmethod
    def _coerce_idx(cls, v):
        try:
            return int(v) if v is not None and v != "" else -1
        except (ValueError, TypeError):
            return -1

    @field_validator("total_score", mode="before")
    @classmethod
    def _coerce_total(cls, v):
        n = _as_float(v, default=0.0)
        return max(0.0, min(100.0, n))

    @field_validator(
        "matched_hard_skills", "missing_hard_skills", "matched_soft_skills",
        "strengths", "gaps",
        mode="before",
    )
    @classmethod
    def _coerce_list(cls, v):
        out = []
        for item in _as_list(v):
            if isinstance(item, dict):
                s = _as_str(item.get("skill") or item.get("name") or item.get("text") or "")
                if s.strip():
                    out.append(s)
            elif isinstance(item, str) and item.strip():
                out.append(item)
        return out

    @field_validator("name", "recommendation_note", mode="before")
    @classmethod
    def _coerce_str(cls, v):
        return _as_str(v)


# ─────────────────────────────────────────────────────────────────────────────
# Interview question schema
# ─────────────────────────────────────────────────────────────────────────────


VALID_QUESTION_CATEGORIES = {
    "technical", "behavioral", "situational", "experience", "role_specific",
}


class QuestionSchema(BaseModel):
    model_config = ConfigDict(extra="allow")
    category: str = "technical"
    question: str = ""
    purpose: str = ""
    expected_good_answer: str = ""
    follow_up: str = ""

    @field_validator("category", mode="before")
    @classmethod
    def _normalize_category(cls, v):
        s = _as_str(v).strip().lower()
        return s if s in VALID_QUESTION_CATEGORIES else "technical"

    @field_validator(
        "question", "purpose", "expected_good_answer", "follow_up",
        mode="before",
    )
    @classmethod
    def _coerce_str(cls, v):
        return _as_str(v)


# ─────────────────────────────────────────────────────────────────────────────
# Public safe-parse API
# ─────────────────────────────────────────────────────────────────────────────


def safe_parse_jd(raw: dict | None) -> dict:
    """Validate + normalize a JD dict from LLM. Returns a plain dict with
    guaranteed field shapes. Extra fields are preserved."""
    try:
        return JDSchema.model_validate(raw or {}).model_dump()
    except ValidationError:
        return JDSchema().model_dump()


def safe_parse_cv(raw: dict | None) -> dict:
    try:
        return CVSchema.model_validate(raw or {}).model_dump()
    except ValidationError:
        return CVSchema().model_dump()


def safe_parse_evaluations(raw: dict | list | None) -> list[dict]:
    """Accept either `{"evaluations": [...]}` or a bare list."""
    if raw is None:
        return []
    if isinstance(raw, dict):
        items = raw.get("evaluations") or []
    elif isinstance(raw, list):
        items = raw
    else:
        return []
    out: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            out.append(EvaluationSchema.model_validate(item).model_dump())
        except ValidationError:
            out.append(EvaluationSchema(
                candidate_index=item.get("candidate_index", -1) if isinstance(item.get("candidate_index"), int) else -1,
                name=_as_str(item.get("name", "")),
            ).model_dump())
    return out


def safe_parse_questions(raw: dict | list | None) -> list[dict]:
    """Accept either `{"questions": [...]}` or a bare list."""
    if raw is None:
        return []
    if isinstance(raw, dict):
        items = raw.get("questions") or []
    elif isinstance(raw, list):
        items = raw
    else:
        return []
    out: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            out.append(QuestionSchema.model_validate(item).model_dump())
        except ValidationError:
            continue
    return out
