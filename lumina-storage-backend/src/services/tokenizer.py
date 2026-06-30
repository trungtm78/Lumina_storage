"""Shim (Phase 8 W3 Task A): tokenizer đã chuyển sang src/shared/.

Pure util đếm/cắt token (tiktoken) dùng XUYÊN domain (embedding + document ingest worker).
Re-export TƯỜNG MINH mọi symbol public (KHÔNG `import *`) để import path cũ vẫn chạy tới khi
gỡ shim (Task 10). Xem plan W3 §Task A.
"""
from src.shared.tokenizer import (  # noqa: F401
    count_tokens,
    encode_tokens,
    truncate_to_token_limit,
)

__all__ = ["count_tokens", "encode_tokens", "truncate_to_token_limit"]
