"""Phase 4 T6 — chuẩn hóa Citation cho collector.search_results + xóa dead query_vector_db.

- query_vector_db: DEAD (không trong TOOLS=[rag_search]) → xóa khỏi module + TOOLS.
- collector.search_results giờ MỘT shape: Citation dict (rag_search + parse_document
  _sources đều dict). Builder dùng dict-only (bỏ hasattr/get song shape).
- citation_to_source(): map Citation dict → ChatMessageSource (resilient .get()).
"""
import uuid

import src.services.agent as agent_mod
from src.services.chat_service import citation_to_source, citations_to_sources


def test_query_vector_db_removed():
    # Dead tool (không trong TOOLS) → không còn tồn tại trong module.
    assert not hasattr(agent_mod, "query_vector_db")
    tool_names = {getattr(t, "name", None) for t in agent_mod.TOOLS}
    assert "query_vector_db" not in tool_names


def test_citation_to_source_maps_full_dict():
    mid = uuid.uuid4()
    did = uuid.uuid4()
    cid = uuid.uuid4()
    src = citation_to_source(
        {
            "document_id": str(did),
            "chunk_id": str(cid),
            "page_number": 3,
            "content": "x" * 600,
            "score": 0.9,
        },
        mid,
        1,
    )
    assert src.message_id == mid
    # document_id/chunk_id coerce str → UUID
    assert src.document_id == did
    assert src.chunk_id == cid
    assert src.citation_index == 1
    assert src.page_number == 3
    assert src.relevance_score == 0.9
    assert src.excerpt == "x" * 500  # cắt 500 ký tự


def test_citation_to_source_invalid_chunk_id_to_none():
    # chunk_id nullable: không-UUID → None (không crash DB write).
    src = citation_to_source(
        {"document_id": str(uuid.uuid4()), "chunk_id": "not-a-uuid", "content": "x"},
        uuid.uuid4(),
        1,
    )
    assert src.chunk_id is None


def test_citation_to_source_handles_partial_dict():
    # parse_document _sources từ skill script có thể thiếu key → .get() resilient.
    mid = uuid.uuid4()
    src = citation_to_source({"document_id": str(uuid.uuid4()), "content": ""}, mid, 2)
    assert src.chunk_id is None
    assert src.page_number is None
    assert src.relevance_score is None
    assert src.excerpt is None  # content rỗng → None (đồng nhất simple-chat path)
    assert src.citation_index == 2


def test_citations_to_sources_skips_missing_document_id():
    # Skill _sources lỗi (thiếu/None document_id) → BỎ (ChatMessageSource.document_id
    # NOT NULL → nếu build sẽ poison commit, crash cả chat). Resilient guard.
    mid = uuid.uuid4()
    cites = [
        {"document_id": str(uuid.uuid4()), "content": "a"},
        {"content": "thiếu document_id"},
        {"document_id": None, "content": "document_id None"},
        {"document_id": str(uuid.uuid4()), "content": "b"},
    ]
    sources = citations_to_sources(cites, mid)
    assert len(sources) == 2
    # citation_index liên tục 1..2 (không gap dù đã bỏ entry lỗi giữa chừng)
    assert [s.citation_index for s in sources] == [1, 2]
    assert all(s.message_id == mid for s in sources)


def test_citations_to_sources_skips_non_dict_and_invalid_uuid():
    # Skill _sources lỗi nặng: entry không phải dict, hoặc document_id không-UUID →
    # BỎ (tránh AttributeError + DB UUID-parse fail poison commit). Chỉ giữ entry hợp lệ.
    mid = uuid.uuid4()
    good = str(uuid.uuid4())
    cites = [
        "không phải dict",
        None,
        {"document_id": "not-a-uuid", "content": "invalid doc id"},
        {"document_id": good, "content": "ok"},
    ]
    sources = citations_to_sources(cites, mid)
    assert len(sources) == 1
    assert str(sources[0].document_id) == good
    assert sources[0].citation_index == 1


def test_citations_to_sources_empty_list():
    assert citations_to_sources([], uuid.uuid4()) == []
