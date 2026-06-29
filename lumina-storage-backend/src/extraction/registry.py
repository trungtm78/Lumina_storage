"""Phase 5b — registry provider extraction (name → class). Selector (Task 3) tra registry
để dựng provider theo config. local_hybrid đăng ký sẵn (mặc định, luôn có). Adapter ngoài
(Gemini/Mistral/Azure/Landing AI) đăng ký ở Task 4-7; availability theo SDK ở Task 8.
"""
from src.extraction.base import ExtractionProvider
from src.extraction.local_hybrid import LocalHybridProvider

REGISTRY: dict[str, type[ExtractionProvider]] = {}


def register(name: str, cls: type[ExtractionProvider]) -> None:
    REGISTRY[name] = cls


def get_provider_class(name: str) -> type[ExtractionProvider] | None:
    return REGISTRY.get(name)


register(LocalHybridProvider.name, LocalHybridProvider)
