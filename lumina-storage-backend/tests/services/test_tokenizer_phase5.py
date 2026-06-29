"""Phase 5a Task 2b — tokenizer đếm/encode token THẬT (tiktoken), pluggable theo model.

R4/CQ1: count_tokens(text, model) + encode_tokens + truncate_to_token_limit; map model→
encoding (fallback cl100k_base; fallback ~len/4 khi tiktoken thiếu). KHÔNG hardcode 1 encoding.
"""
from src.services.tokenizer import count_tokens, encode_tokens, truncate_to_token_limit


def test_count_tokens_basic():
    assert count_tokens("hello world") > 0
    assert count_tokens("") == 0


def test_count_tokens_deterministic():
    assert count_tokens("Tiếng Việt có dấu") == count_tokens("Tiếng Việt có dấu")


def test_count_tokens_accepts_model_with_provider_prefix():
    # azure/gpt-4o → bỏ prefix, map encoding (hoặc fallback cl100k) — không raise.
    assert count_tokens("hello", model="azure/gpt-4o") > 0
    assert count_tokens("hello", model="gpt-4o") > 0


def test_encode_tokens_returns_list():
    toks = encode_tokens("hello world")
    assert isinstance(toks, list) and len(toks) > 0


def test_truncate_to_token_limit_cuts_by_token():
    text = "từ " * 1000  # nhiều token
    out = truncate_to_token_limit(text, limit=10)
    assert count_tokens(out) <= 10
    assert len(out) < len(text)


def test_truncate_short_text_unchanged():
    text = "ngắn gọn"
    assert truncate_to_token_limit(text, limit=1000) == text
