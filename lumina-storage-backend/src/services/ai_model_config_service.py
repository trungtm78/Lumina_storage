"""Shim (Phase 8 W3 Task A): ai_model_config_service đã chuyển sang src/shared/.

AI model-config resolve = shared kernel dùng XUYÊN domain (chat/review/generator/extraction/
worker đều resolve model qua đây). Re-export TƯỜNG MINH MỌI symbol public được import từ ngoài
(KHÔNG `import *`) để import path cũ vẫn chạy tới khi gỡ shim (Task 10). Xem plan W3 §Task A.
"""
from src.shared.ai_model_config_service import (  # noqa: F401
    AIModelConfigNotFoundError,
    AIModelConfigService,
    LiteLLMConfig,
    build_litellm_model,
    get_default_litellm_config,
)

__all__ = [
    "AIModelConfigNotFoundError",
    "AIModelConfigService",
    "LiteLLMConfig",
    "build_litellm_model",
    "get_default_litellm_config",
]
