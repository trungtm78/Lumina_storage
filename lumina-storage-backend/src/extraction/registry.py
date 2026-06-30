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


def available_providers() -> list[str]:
    """Provider KHẢ DỤNG (SDK optional đã cài) — UI dropdown chỉ hiện cái này."""
    return sorted(name for name, cls in REGISTRY.items() if cls.is_available())


register(LocalHybridProvider.name, LocalHybridProvider)

# Provider ngoài — import module an toàn (SDK lazy bên trong extract/test_connection;
# import provider module KHÔNG kéo SDK). Gemini qua litellm (luôn khả dụng).
from src.extraction.providers.azure_di import AzureDIProvider  # noqa: E402
from src.extraction.providers.gemini import GeminiProvider  # noqa: E402
from src.extraction.providers.landing_ai import LandingAIProvider  # noqa: E402
from src.extraction.providers.mistral import MistralProvider  # noqa: E402

register(GeminiProvider.name, GeminiProvider)
register(MistralProvider.name, MistralProvider)
register(AzureDIProvider.name, AzureDIProvider)
register(LandingAIProvider.name, LandingAIProvider)
