"""Phase 5b Task 8 — registry availability filter: provider có SDK optional chưa cài → ẩn
khỏi available_providers() (UI dropdown) + is_available() False. local_hybrid/gemini luôn có.
"""
from src.extraction.providers.azure_di import AzureDIProvider
from src.extraction.providers.gemini import GeminiProvider
from src.extraction.providers.landing_ai import LandingAIProvider
from src.extraction.local_hybrid import LocalHybridProvider
from src.extraction.providers.mistral import MistralProvider
from src.extraction.registry import available_providers


def test_local_and_gemini_always_available():
    av = available_providers()
    assert "local_hybrid" in av and "gemini" in av


def test_optional_sdk_providers_hidden_when_missing():
    # mistralai / azure-ai-documentintelligence / agentic-doc KHÔNG cài trong test env → ẩn.
    av = available_providers()
    assert "mistral" not in av
    assert "azure_di" not in av
    assert "landing_ai" not in av


def test_is_available_flags():
    assert LocalHybridProvider.is_available() is True
    assert GeminiProvider.is_available() is True
    assert MistralProvider.is_available() is False
    assert AzureDIProvider.is_available() is False
    assert LandingAIProvider.is_available() is False
