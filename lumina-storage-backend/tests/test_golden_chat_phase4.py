"""Phase 4 T7 — golden citation-stability test.

Khoá bất biến pipeline citation hợp nhất (T6/T7): citations_to_sources LOSSLESS +
DETERMINISTIC trên golden retrieval cố định → tập doc_ids cited == doc_ids retrieval
(Jaccard = 1.0), và ổn định qua nhiều lần chạy. Đây là điều kiện (proxy) để bật
luồng hợp nhất an toàn — không phụ thuộc Qdrant/LLM thật.
"""
import uuid

import pytest

from src.services.chat_service import citations_to_sources
from tests.golden_chat_questions import GOLDEN_QUESTIONS


def _jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 1.0
    return len(a & b) / len(a | b)


@pytest.mark.parametrize("item", GOLDEN_QUESTIONS, ids=lambda it: it["question"])
def test_citation_pipeline_lossless_jaccard_1(item):
    mid = uuid.uuid4()
    expected_doc_ids = {c["document_id"] for c in item["citations"]}

    sources = citations_to_sources(item["citations"], mid)
    got_doc_ids = {str(s.document_id) for s in sources}

    # Lossless: mọi doc_id retrieval đều thành citation (không rớt) → Jaccard = 1.0.
    assert _jaccard(expected_doc_ids, got_doc_ids) == 1.0
    # citation_index liên tục 1..N, không trùng.
    idxs = [s.citation_index for s in sources]
    assert idxs == list(range(1, len(item["citations"]) + 1))


def test_citation_pipeline_deterministic_across_runs():
    # Chạy lại 2 lần trên cùng golden → cùng tập doc_ids theo cùng thứ tự (deterministic).
    mid = uuid.uuid4()
    for item in GOLDEN_QUESTIONS:
        run1 = [str(s.document_id) for s in citations_to_sources(item["citations"], mid)]
        run2 = [str(s.document_id) for s in citations_to_sources(item["citations"], mid)]
        assert run1 == run2
        assert _jaccard(set(run1), set(run2)) == 1.0


def test_golden_has_enough_questions():
    # Spec: 5-10 câu golden.
    assert 5 <= len(GOLDEN_QUESTIONS) <= 10
