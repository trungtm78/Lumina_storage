"""Phase 4 — AI Gateway: điểm vào DUY NHẤT cho LLM / Embedding / VLM.

Thin facade delegate sang service/litellm đã có (LLMService, EmbeddingService,
litellm, build_model) + gắn tracing hook ở MỘT chỗ. KHÔNG nhồi logic (tránh god-class).
"""
from src.ai.gateway import AIGateway

__all__ = ["AIGateway"]
