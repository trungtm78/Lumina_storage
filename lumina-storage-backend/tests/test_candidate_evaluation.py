"""Test scenario for Candidate Evaluation skill.

Covers:
  - Unit tests for prompts, report renderer, tool scripts
  - API endpoint integration tests
  - End-to-end workflow simulation (5-step wizard)
"""

import json
import sys
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient

from src.models.storage import StorageConfig
from src.models.user import User

# ── Add skill tools to path for direct imports ───────────────────────────────
_TOOLS_DIR = str(Path(__file__).resolve().parent.parent / "skills" / "candidate-evaluation" / "tools")
if _TOOLS_DIR not in sys.path:
    sys.path.insert(0, _TOOLS_DIR)


# ═══════════════════════════════════════════════════════════════════════════════
# Sample data
# ═══════════════════════════════════════════════════════════════════════════════

SAMPLE_JD_TEXT = """
# Senior Backend Engineer
Company: Lumina Technology JSC
Location: Ho Chi Minh City
Requirements: 3-5 years Python, FastAPI, PostgreSQL, Redis, Docker
Nice to have: Kubernetes, AWS
Education: Bachelor CS
"""

SAMPLE_JD_PARSED = {
    "job_title": "Senior Backend Engineer",
    "company": "Lumina Technology JSC",
    "department": "",
    "location": "Ho Chi Minh City",
    "work_mode": "onsite",
    "employment_type": "full-time",
    "experience_range": {"min_years": 3, "max_years": 5, "preferred_years": 4},
    "salary_range": {"min": "", "max": "", "currency": ""},
    "required_skills": [
        {"skill": "Python", "level": "advanced", "priority": "must-have"},
        {"skill": "FastAPI", "level": "advanced", "priority": "must-have"},
        {"skill": "PostgreSQL", "level": "intermediate", "priority": "must-have"},
    ],
    "nice_to_have_skills": [
        {"skill": "Kubernetes", "level": "intermediate", "priority": "nice-to-have"},
    ],
    "education": {"min_level": "Bachelor", "preferred_fields": ["CS"]},
    "responsibilities": ["Design APIs", "Write tests"],
    "benefits": [],
    "certifications_required": [],
    "languages_required": [],
    "culture_keywords": [],
    "summary": "Senior Backend Engineer tại Lumina.",
}

SAMPLE_CANDIDATE_1 = {
    "index": 0,
    "document_id": "doc-cv-1",
    "original_filename": "NguyenVanA.pdf",
    "name": "Nguyen Van A",
    "email": "a@test.com",
    "phone": "0901234567",
    "location": "HCMC",
    "current_role": "Backend Engineer",
    "current_company": "ABC Corp",
    "experience_years": 6,
    "skills": ["Python", "FastAPI", "PostgreSQL", "Docker"],
    "skill_details": [{"skill": "Python", "level": "advanced", "years": 6}],
    "education": [{"degree": "BS", "field": "CS", "school": "HCMUT", "year": "2018", "gpa": ""}],
    "certifications": [],
    "languages": [],
    "summary": "Backend Engineer 6 năm.",
}

SAMPLE_CANDIDATE_2 = {
    "index": 1,
    "document_id": "doc-cv-2",
    "original_filename": "TranThiB.pdf",
    "name": "Tran Thi B",
    "email": "b@test.com",
    "phone": "",
    "location": "",
    "current_role": "Frontend Developer",
    "current_company": "DEF Inc",
    "experience_years": 3,
    "skills": ["React", "TypeScript"],
    "skill_details": [],
    "education": [{"degree": "BS", "field": "IT", "school": "UIT", "year": "2021", "gpa": ""}],
    "certifications": [],
    "languages": [],
    "summary": "Frontend Dev 3 năm.",
}

SAMPLE_RANKING_1 = {
    "rank": 1,
    "candidate_index": 0,
    "name": "Nguyen Van A",
    "total_score": 85,
    "scores": {
        "required_skills": 90,
        "nice_to_have_skills": 60,
        "experience_relevance": 88,
        "education_fit": 80,
        "overall_impression": 85,
    },
    "strengths": ["Strong Python match"],
    "gaps": ["No K8s experience"],
    "recommendation": "strong_fit",
    "recommendation_note": "Excellent match.",
}

SAMPLE_RANKING_2 = {
    "rank": 2,
    "candidate_index": 1,
    "name": "Tran Thi B",
    "total_score": 35,
    "scores": {
        "required_skills": 20,
        "nice_to_have_skills": 10,
        "experience_relevance": 30,
        "education_fit": 70,
        "overall_impression": 40,
    },
    "strengths": ["Good education"],
    "gaps": ["No Python"],
    "recommendation": "not_recommended",
    "recommendation_note": "Skill mismatch.",
}


# ═══════════════════════════════════════════════════════════════════════════════
# Helper: mock ctx
# ═══════════════════════════════════════════════════════════════════════════════

def _make_ctx(**overrides):
    ctx = MagicMock()
    ctx.get_document_bytes = AsyncMock(return_value=SAMPLE_JD_TEXT.encode())
    ctx.settings = MagicMock(gotenberg_url="http://gotenberg:3000")
    ctx.save_rendered_document = AsyncMock(return_value=uuid.uuid4())
    ctx.db = MagicMock()
    ctx.db.execute = AsyncMock(return_value=MagicMock(
        fetchone=MagicMock(return_value=("test.pdf",))
    ))
    ctx.llm_call = AsyncMock(return_value="{}")
    for k, v in overrides.items():
        setattr(ctx, k, v)
    return ctx


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Unit tests — Prompts
# ═══════════════════════════════════════════════════════════════════════════════


class TestPrompts:
    def test_prompts_exist(self):
        from _prompts import JD_PARSE_PROMPT, CV_PARSE_PROMPT, MATCH_SCORE_PROMPT, INTERVIEW_QUESTIONS_PROMPT
        assert all(len(p) > 100 for p in [JD_PARSE_PROMPT, CV_PARSE_PROMPT, MATCH_SCORE_PROMPT, INTERVIEW_QUESTIONS_PROMPT])

    def test_json_instruction(self):
        from _prompts import JD_PARSE_PROMPT, CV_PARSE_PROMPT, MATCH_SCORE_PROMPT
        for p in [JD_PARSE_PROMPT, CV_PARSE_PROMPT, MATCH_SCORE_PROMPT]:
            assert "JSON" in p or "json" in p

    def test_scoring_weights(self):
        from _prompts import MATCH_SCORE_PROMPT
        assert "35%" in MATCH_SCORE_PROMPT  # hard_skills_match
        assert "25%" in MATCH_SCORE_PROMPT  # experience_relevance
        assert "10%" in MATCH_SCORE_PROMPT  # soft_skills, nice_to_have, education, overall


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Unit tests — Report renderer
# ═══════════════════════════════════════════════════════════════════════════════


class TestReport:
    def test_render_basic(self):
        from _report import render_evaluation_report
        html = render_evaluation_report({
            "jd": SAMPLE_JD_PARSED,
            "candidates": [SAMPLE_CANDIDATE_1, SAMPLE_CANDIDATE_2],
            "rankings": [SAMPLE_RANKING_1, SAMPLE_RANKING_2],
            "interview_questions": {},
            "top_n": 2,
        })
        assert "<!DOCTYPE html>" in html
        assert "Senior Backend Engineer" in html
        assert "Nguyen Van A" in html
        assert "Rất phù hợp" in html

    def test_render_with_questions(self):
        from _report import render_evaluation_report
        html = render_evaluation_report({
            "jd": SAMPLE_JD_PARSED,
            "candidates": [SAMPLE_CANDIDATE_1],
            "rankings": [SAMPLE_RANKING_1],
            "interview_questions": {
                "0": [{"category": "technical", "question": "FastAPI question?", "purpose": "Test", "expected_good_answer": "", "follow_up": ""}]
            },
            "top_n": 1,
        })
        assert "FastAPI question?" in html

    def test_render_empty(self):
        from _report import render_evaluation_report
        html = render_evaluation_report({
            "jd": {"job_title": "Test", "required_skills": [], "nice_to_have_skills": []},
            "candidates": [], "rankings": [], "interview_questions": {}, "top_n": 0,
        })
        assert "<!DOCTYPE html>" in html

    def test_html_escaping(self):
        from _report import _esc
        assert "&lt;" in _esc("<script>")
        assert _esc(None) == ""

    def test_score_color(self):
        from _report import _score_color
        assert "10B981" in _score_color(80)   # green
        assert "F59E0B" in _score_color(60)   # yellow
        assert "EF4444" in _score_color(30)   # red


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Unit tests — parse_jd.py
# ═══════════════════════════════════════════════════════════════════════════════


class TestParseJD:
    @pytest.mark.asyncio
    async def test_success(self):
        from parse_jd import run
        ctx = _make_ctx(llm_call=AsyncMock(return_value=json.dumps(SAMPLE_JD_PARSED)))
        result = await run({"document_ids": ["doc-1"]}, ctx)
        assert "error" not in result
        assert result["jd"]["job_title"] == "Senior Backend Engineer"
        assert result["_state"]["jd_document_id"] == "doc-1"

    @pytest.mark.asyncio
    async def test_no_document_ids(self):
        from parse_jd import run
        result = await run({"document_ids": []}, MagicMock())
        assert "error" in result

    @pytest.mark.asyncio
    async def test_empty_text(self):
        from parse_jd import run
        ctx = _make_ctx(get_document_bytes=AsyncMock(return_value=b""))
        with patch("markitdown.MarkItDown") as MockMD:
            MockMD.return_value.convert_stream.return_value = MagicMock(text_content="")
            result = await run({"document_ids": ["doc-empty"]}, ctx)
        assert "error" in result


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Unit tests — parse_cvs.py
# ═══════════════════════════════════════════════════════════════════════════════


class TestParseCVs:
    @pytest.mark.asyncio
    async def test_success(self):
        from parse_cvs import run
        ctx = _make_ctx(llm_call=AsyncMock(return_value=json.dumps(SAMPLE_CANDIDATE_1)))
        result = await run({"document_ids": ["doc-cv-1"], "_state": {}}, ctx)
        assert "error" not in result
        assert result["candidates_count"] == 1
        assert result["candidates"][0]["name"] == "Nguyen Van A"

    @pytest.mark.asyncio
    async def test_dedup(self):
        from parse_cvs import run
        ctx = _make_ctx()
        result = await run({
            "document_ids": ["doc-cv-1"],
            "_state": {"candidates": [SAMPLE_CANDIDATE_1]},
        }, ctx)
        assert result["candidates_count"] == 1
        assert "Không có CV mới" in result["candidates_summary"]
        ctx.get_document_bytes.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_ids(self):
        from parse_cvs import run
        result = await run({"document_ids": []}, MagicMock())
        assert "error" in result


# ═══════════════════════════════════════════════════════════════════════════════
# 5. Unit tests — match_candidates.py
# ═══════════════════════════════════════════════════════════════════════════════


class TestMatchCandidates:
    @pytest.mark.asyncio
    async def test_success(self):
        from match_candidates import run
        evals = {"evaluations": [{**SAMPLE_RANKING_1, "rank": 0}, {**SAMPLE_RANKING_2, "rank": 0}]}
        ctx = _make_ctx(llm_call=AsyncMock(return_value=json.dumps(evals)))
        result = await run({
            "top_n": 1,
            "_state": {"jd": SAMPLE_JD_PARSED, "candidates": [SAMPLE_CANDIDATE_1, SAMPLE_CANDIDATE_2]},
        }, ctx)
        assert result["shortlist_count"] == 1
        assert result["rankings"][0]["name"] == "Nguyen Van A"
        assert result["rankings"][0]["rank"] == 1

    @pytest.mark.asyncio
    async def test_missing_jd(self):
        from match_candidates import run
        result = await run({"_state": {"candidates": [SAMPLE_CANDIDATE_1]}}, MagicMock())
        assert "error" in result

    @pytest.mark.asyncio
    async def test_missing_candidates(self):
        from match_candidates import run
        result = await run({"_state": {"jd": SAMPLE_JD_PARSED}}, MagicMock())
        assert "error" in result

    @pytest.mark.asyncio
    async def test_skips_errored_candidates(self):
        from match_candidates import run
        errored = {**SAMPLE_CANDIDATE_2, "error": "parse failed"}
        evals = {"evaluations": [{**SAMPLE_RANKING_1, "rank": 0}]}
        ctx = _make_ctx(llm_call=AsyncMock(return_value=json.dumps(evals)))
        result = await run({
            "top_n": 5,
            "_state": {"jd": SAMPLE_JD_PARSED, "candidates": [SAMPLE_CANDIDATE_1, errored]},
        }, ctx)
        assert result["total_evaluated"] == 1

    def test_format_jd(self):
        from match_candidates import _format_jd_for_prompt
        text = _format_jd_for_prompt(SAMPLE_JD_PARSED)
        assert "Senior Backend Engineer" in text
        assert "Python" in text

    def test_format_candidate(self):
        from match_candidates import _format_candidate_for_prompt
        text = _format_candidate_for_prompt(SAMPLE_CANDIDATE_1)
        assert "Nguyen Van A" in text
        assert "Backend Engineer" in text


# ═══════════════════════════════════════════════════════════════════════════════
# 6. Unit tests — generate_questions.py
# ═══════════════════════════════════════════════════════════════════════════════


class TestGenerateQuestions:
    @pytest.mark.asyncio
    async def test_success(self):
        from generate_questions import run
        q_resp = {"questions": [{"category": "technical", "question": "Q?", "purpose": "P", "expected_good_answer": "", "follow_up": "F"}]}
        ctx = _make_ctx(llm_call=AsyncMock(return_value=json.dumps(q_resp)))
        result = await run({
            "_state": {
                "jd": SAMPLE_JD_PARSED,
                "candidates": [SAMPLE_CANDIDATE_1],
                "rankings": [SAMPLE_RANKING_1],
                "shortlist_indices": [0],
            },
        }, ctx)
        assert result["questions_count"] >= 1
        assert "0" in result["_state"]["interview_questions"]

    @pytest.mark.asyncio
    async def test_missing_jd(self):
        from generate_questions import run
        result = await run({"_state": {}}, MagicMock())
        assert "error" in result


# ═══════════════════════════════════════════════════════════════════════════════
# 7. Unit tests — generate_report.py
# ═══════════════════════════════════════════════════════════════════════════════


class TestGenerateReport:
    @pytest.mark.asyncio
    async def test_success(self):
        from generate_report import run
        rendered_id = uuid.uuid4()
        ctx = _make_ctx(save_rendered_document=AsyncMock(return_value=rendered_id))
        with patch("generate_report._html_to_pdf", new_callable=AsyncMock) as mock_pdf:
            mock_pdf.return_value = b"%PDF-fake"
            result = await run({
                "document_ids": ["doc-jd-1"],
                "_state": {
                    "jd": SAMPLE_JD_PARSED, "candidates": [SAMPLE_CANDIDATE_1],
                    "rankings": [SAMPLE_RANKING_1], "interview_questions": {},
                    "jd_document_id": "doc-jd-1", "top_n": 1,
                },
            }, ctx)
        assert result["rendered_document_id"] == str(rendered_id)

    @pytest.mark.asyncio
    async def test_missing_rankings(self):
        from generate_report import run
        result = await run({"_state": {"jd": SAMPLE_JD_PARSED}}, MagicMock())
        assert "error" in result


# ═══════════════════════════════════════════════════════════════════════════════
# 7b. Unit tests — failure modes (score_error, failed_document_ids, OCR)
# ═══════════════════════════════════════════════════════════════════════════════


class TestFailureModes:
    """Regression tests for partial-failure paths added during hardening."""

    @pytest.mark.asyncio
    async def test_match_score_error_on_llm_failure(self):
        """When an LLM scoring batch raises, each candidate in that batch gets
        score_error set, total_score=None, recommendation='error', and is
        excluded from the shortlist."""
        from match_candidates import run

        ctx = _make_ctx(llm_call=AsyncMock(side_effect=RuntimeError("LLM timeout")))
        result = await run({
            "top_n": 5,
            "_state": {
                "jd": SAMPLE_JD_PARSED,
                "candidates": [SAMPLE_CANDIDATE_1, SAMPLE_CANDIDATE_2],
            },
        }, ctx)

        assert "error" not in result
        assert len(result["rankings"]) == 2
        for ev in result["rankings"]:
            assert ev.get("score_error")
            assert ev["total_score"] is None
            assert ev["recommendation"] == "error"
            assert ev["scores"] == {}
        # Failed candidates must not appear in shortlist
        assert result["shortlist_count"] == 0
        assert result["_state"]["shortlist_indices"] == []

    @pytest.mark.asyncio
    async def test_match_mixes_failed_and_successful_batches(self):
        """Sort order: successes ranked normally at top, failures sunk to bottom."""
        from match_candidates import run

        call_count = {"n": 0}
        successful_evals = {"evaluations": [{**SAMPLE_RANKING_1, "rank": 0}]}

        async def _flaky_llm(*_args, **_kw):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return json.dumps(successful_evals)
            raise RuntimeError("boom")

        ctx = _make_ctx(llm_call=_flaky_llm)
        # BATCH_SIZE controls how candidates are chunked; with default batching,
        # we need one batch to succeed and another to fail. Force this by patching.
        with patch("match_candidates.BATCH_SIZE", 1):
            result = await run({
                "top_n": 5,
                "_state": {
                    "jd": SAMPLE_JD_PARSED,
                    "candidates": [SAMPLE_CANDIDATE_1, SAMPLE_CANDIDATE_2],
                },
            }, ctx)

        assert len(result["rankings"]) == 2
        # First rank is the successful candidate, failed one sunk last
        assert result["rankings"][0].get("score_error") is None
        assert result["rankings"][1].get("score_error") is not None
        assert result["rankings"][1]["total_score"] is None
        # Shortlist contains only the successfully-scored candidate
        assert result["shortlist_count"] == 1
        assert result["_state"]["shortlist_indices"] == [result["rankings"][0]["candidate_index"]]

    @pytest.mark.asyncio
    async def test_parse_cvs_fail_fast_when_all_cvs_fail(self):
        """If every CV in a batch fails to extract/parse, surface a top-level
        error with failed_document_ids so the UI can flag the whole upload."""
        from parse_cvs import run

        async def _boom(*_args, **_kw):
            raise RuntimeError("extraction broke")

        ctx = _make_ctx()
        with patch("parse_cvs._extract_text", new=_boom):
            result = await run({
                "document_ids": ["cv-a", "cv-b"],
                "_state": {},
            }, ctx)

        assert "error" in result
        assert set(result["failed_document_ids"]) == {"cv-a", "cv-b"}
        assert len(result["errors"]) == 2

    @pytest.mark.asyncio
    async def test_parse_cvs_partial_failure_returns_failed_ids(self):
        """Mixed success/failure: successful CVs are kept, failed ones surface
        via failed_document_ids (machine-readable) and errors (human-readable)."""
        from parse_cvs import run

        call_idx = {"i": 0}

        async def _flaky_extract(ctx, doc_id):
            call_idx["i"] += 1
            if doc_id == "cv-bad":
                raise RuntimeError("OCR failed")
            return (SAMPLE_JD_TEXT, f"{doc_id}.pdf")

        ctx = _make_ctx(llm_call=AsyncMock(return_value=json.dumps(SAMPLE_CANDIDATE_1)))
        with patch("parse_cvs._extract_text", new=_flaky_extract):
            result = await run({
                "document_ids": ["cv-good", "cv-bad"],
                "_state": {},
            }, ctx)

        assert "error" not in result
        assert result["new_parsed"] == 1
        assert result["failed_count"] == 1
        assert result["failed_document_ids"] == ["cv-bad"]
        assert len(result["errors"]) == 1

    def test_low_text_extraction_error_shape(self):
        """LowTextExtractionError carries filename + char_count and a Vietnamese
        message the UI can surface verbatim."""
        from _ocr import LowTextExtractionError, UNUSABLE_TEXT_THRESHOLD

        assert UNUSABLE_TEXT_THRESHOLD == 50
        exc = LowTextExtractionError("broken.pdf", 12)
        assert exc.filename == "broken.pdf"
        assert exc.char_count == 12
        assert "broken.pdf" in str(exc)
        assert "12" in str(exc)
        assert isinstance(exc, RuntimeError)


# ═══════════════════════════════════════════════════════════════════════════════
# 8. Integration tests — API endpoints (mocked skill execution)
# ═══════════════════════════════════════════════════════════════════════════════


class TestAPI:
    @pytest.mark.asyncio
    async def test_unauthenticated(self, async_client: AsyncClient):
        resp = await async_client.post("/api/v1/candidate-evaluation/parse-jd", json={"document_id": str(uuid.uuid4())})
        assert resp.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_parse_jd(self, async_client: AsyncClient, auth_headers: dict, default_storage_config: StorageConfig):
        with patch("src.api.v1.routes.candidate_evaluation.SkillService") as Mock:
            svc = Mock.return_value
            svc.get_by_name.return_value = MagicMock()
            svc.resolve_model = AsyncMock(return_value=("m", "k", "b", "v", None))
            svc.run_tool = AsyncMock(return_value={
                "jd": SAMPLE_JD_PARSED, "jd_summary": "Summary", "jd_filename": "jd.pdf",
            })
            resp = await async_client.post(
                "/api/v1/candidate-evaluation/parse-jd",
                json={"document_id": str(uuid.uuid4())},
                headers=auth_headers,
            )
        assert resp.status_code == 200
        assert resp.json()["jd"]["job_title"] == "Senior Backend Engineer"

    @pytest.mark.asyncio
    async def test_match(self, async_client: AsyncClient, auth_headers: dict, default_storage_config: StorageConfig):
        with patch("src.api.v1.routes.candidate_evaluation.SkillService") as Mock:
            svc = Mock.return_value
            svc.get_by_name.return_value = MagicMock()
            svc.resolve_model = AsyncMock(return_value=("m", "k", "b", "v", None))
            svc.run_tool = AsyncMock(return_value={
                "shortlist_count": 1, "total_evaluated": 2,
                "rankings_summary": "Top 1", "rankings": [SAMPLE_RANKING_1],
                "_state": {"shortlist_indices": [0]},
            })
            resp = await async_client.post(
                "/api/v1/candidate-evaluation/match",
                json={"jd": SAMPLE_JD_PARSED, "candidates": [SAMPLE_CANDIDATE_1], "top_n": 1},
                headers=auth_headers,
            )
        assert resp.status_code == 200
        assert resp.json()["shortlist_count"] == 1

    @pytest.mark.asyncio
    async def test_error_propagation(self, async_client: AsyncClient, auth_headers: dict, default_storage_config: StorageConfig):
        with patch("src.api.v1.routes.candidate_evaluation.SkillService") as Mock:
            svc = Mock.return_value
            svc.get_by_name.return_value = MagicMock()
            svc.resolve_model = AsyncMock(return_value=("m", "k", "b", "v", None))
            svc.run_tool = AsyncMock(return_value={"error": "File not found"})
            resp = await async_client.post(
                "/api/v1/candidate-evaluation/parse-jd",
                json={"document_id": str(uuid.uuid4())},
                headers=auth_headers,
            )
        assert resp.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════════
# 9. End-to-end workflow
# ═══════════════════════════════════════════════════════════════════════════════


class TestEndToEnd:
    @pytest.mark.asyncio
    async def test_full_5_step_workflow(self):
        """parse_jd → parse_cvs → match → questions → report"""
        from parse_jd import run as step1
        from parse_cvs import run as step2
        from match_candidates import run as step3
        from generate_questions import run as step4
        from generate_report import run as step5

        ctx = _make_ctx()

        # Step 1: Parse JD
        ctx.llm_call = AsyncMock(return_value=json.dumps(SAMPLE_JD_PARSED))
        r1 = await step1({"document_ids": ["jd-1"]}, ctx)
        assert "error" not in r1
        state = r1["_state"]

        # Step 2: Parse CVs
        call_idx = {"i": 0}
        cv_responses = [json.dumps(SAMPLE_CANDIDATE_1), json.dumps(SAMPLE_CANDIDATE_2)]
        async def _llm_cv(msgs, **kw):
            i = call_idx["i"]; call_idx["i"] += 1
            return cv_responses[min(i, len(cv_responses) - 1)]
        ctx.llm_call = _llm_cv
        r2 = await step2({"document_ids": ["cv-1", "cv-2"], "_state": state}, ctx)
        assert r2["candidates_count"] == 2
        state = r2["_state"]

        # Step 3: Match
        evals = {"evaluations": [{**SAMPLE_RANKING_1, "rank": 0}, {**SAMPLE_RANKING_2, "rank": 0}]}
        ctx.llm_call = AsyncMock(return_value=json.dumps(evals))
        r3 = await step3({"top_n": 1, "_state": state}, ctx)
        assert r3["rankings"][0]["name"] == "Nguyen Van A"
        state = r3["_state"]

        # Verify state accumulation
        assert all(k in state for k in ("jd", "candidates", "rankings", "shortlist_indices"))

        # Step 4: Questions
        ctx.llm_call = AsyncMock(return_value=json.dumps({
            "questions": [{"category": "technical", "question": "Q?", "purpose": "P", "expected_good_answer": "", "follow_up": ""}]
        }))
        r4 = await step4({"_state": state}, ctx)
        assert r4["questions_count"] >= 1
        state = r4["_state"]

        # Step 5: Report
        with patch("generate_report._html_to_pdf", new_callable=AsyncMock) as mock_pdf:
            mock_pdf.return_value = b"%PDF-fake"
            r5 = await step5({"document_ids": ["jd-1"], "_state": state}, ctx)
        assert r5["rendered_document_id"]
        assert r5["preview_pdf_id"]


# ═══════════════════════════════════════════════════════════════════════════════
# 10. SKILL.md validation
# ═══════════════════════════════════════════════════════════════════════════════


class TestSkillDefinition:
    def test_skill_loads(self):
        from src.services.skill_service import SkillService
        from src.core.config import Settings
        svc = SkillService(Settings(skills_dir="skills", db_host="localhost", db_password="x", secret_key="x"))
        skill = svc.get_by_name("candidate-evaluation")
        assert skill is not None
        assert "ứng viên" in skill.description or "candidate" in skill.description.lower()
        assert skill.triggers and "keywords" in skill.triggers

    def test_skill_scripts(self):
        from src.services.skill_service import SkillService
        from src.core.config import Settings
        svc = SkillService(Settings(skills_dir="skills", db_host="localhost", db_password="x", secret_key="x"))
        skill = svc.get_by_name("candidate-evaluation")
        scripts = {s for s in skill.list_scripts() if not s.startswith("_")}
        expected = {
            "parse_jd",
            "parse_cvs",
            "match_candidates",
            "generate_questions",
            "generate_report",
            "scan_to_master_list",
        }
        assert expected == scripts, f"Missing: {expected - scripts}, Extra: {scripts - expected}"
