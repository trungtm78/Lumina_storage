"""Phase 5a — đếm/encode token THẬT (tiktoken) thay đếm ký tự.

Pluggable theo model (R4/CQ1): map model → encoding qua tiktoken.encoding_for_model
(bỏ prefix provider, vd 'azure/gpt-4o' → 'gpt-4o'); fallback 'cl100k_base' khi model lạ;
fallback ~len/4 khi tiktoken thiếu/lỗi. Dùng cho token_count (ingest) + cắt theo token
(embedding) thay truncate ký tự mù.
"""
from functools import lru_cache

_FALLBACK_ENCODING = "cl100k_base"


@lru_cache(maxsize=16)
def _encoding(model: str | None):
    import tiktoken

    if model:
        name = model.split("/")[-1]  # bỏ prefix provider (azure/gpt-4o → gpt-4o)
        try:
            return tiktoken.encoding_for_model(name)
        except KeyError:
            pass
    return tiktoken.get_encoding(_FALLBACK_ENCODING)


def count_tokens(text: str, model: str | None = None) -> int:
    """Số token thật của text. 0 nếu rỗng. Fallback ~len/4 khi tiktoken không dùng được."""
    if not text:
        return 0
    try:
        return len(_encoding(model).encode(text))
    except Exception:
        return max(1, len(text) // 4)


def encode_tokens(text: str, model: str | None = None) -> list[int]:
    """Token ids. [] khi tiktoken không dùng được (caller fallback theo count_tokens)."""
    if not text:
        return []
    try:
        return _encoding(model).encode(text)
    except Exception:
        return []


def truncate_to_token_limit(text: str, limit: int, model: str | None = None) -> str:
    """Cắt text về tối đa `limit` token THẬT (decode lại) — thay truncate ký tự mù.
    Text dưới limit giữ nguyên. limit<=0 → ''."""
    if limit <= 0:
        return ""
    if not text:
        return text
    try:
        enc = _encoding(model)
        toks = enc.encode(text)
        if len(toks) <= limit:
            return text
        return enc.decode(toks[:limit])
    except Exception:
        approx = limit * 4  # ~4 ký tự/token khi tiktoken thiếu
        return text if len(text) <= approx else text[:approx]
