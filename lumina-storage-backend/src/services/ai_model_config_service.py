import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import get_settings

# LiteLLM requires provider-specific model string prefixes
_LITELLM_PREFIXES: dict[str, str] = {
    "openai": "",
    "azure": "azure/",
    "anthropic": "anthropic/",
    "google": "gemini/",
    "ollama": "ollama/",
}


def build_litellm_model(provider: str, model_name: str) -> str:
    """Return the correct LiteLLM model string for the given provider."""
    prefix = _LITELLM_PREFIXES.get(provider, "")
    if prefix and model_name.startswith(prefix):
        return model_name  # already prefixed
    return f"{prefix}{model_name}"


@dataclass(frozen=True)
class LiteLLMConfig:
    """Resolved LLM/embedding settings for one purpose ('chat' | 'embedding' | 'vlm').

    Built from a database AIModelConfig row, populated by an admin via the UI.
    There is no env-var fallback by design — admins are the only source of
    truth for model selection so credentials don't end up baked into config
    files or shell history.
    """
    model: str
    api_key: str | None = None
    api_base: str | None = None
    api_version: str | None = None

    def to_kwargs(self) -> dict:
        """Subset of fields suitable for splatting into litellm/ChatLiteLLM."""
        kw: dict = {"model": self.model}
        if self.api_key:
            kw["api_key"] = self.api_key
        if self.api_base:
            kw["api_base"] = self.api_base
        if self.api_version:
            kw["api_version"] = self.api_version
        return kw


class AIModelConfigNotFoundError(RuntimeError):
    """Raised when a feature needs an AI model but admin hasn't configured one."""


async def get_default_litellm_config(
    db: AsyncSession, purpose: str
) -> LiteLLMConfig:
    """Look up the admin-configured default model for `purpose`.

    Raises AIModelConfigNotFoundError if no default exists. Callers should
    surface this clearly to the user — there's no env fallback to paper over
    the missing config.
    """
    repo = AIModelConfigRepository(db)
    cfg = await repo.get_default_by_purpose(purpose)
    if cfg is None:
        raise AIModelConfigNotFoundError(
            f"No default AI model configured for purpose='{purpose}'. "
            f"Admin must add one in the AI Model Config admin page."
        )
    extra = cfg.extra_config or {}
    return LiteLLMConfig(
        model=build_litellm_model(cfg.provider, cfg.model_name),
        api_key=cfg.api_key,
        api_base=cfg.base_url,
        api_version=extra.get("api_version"),
    )


from src.core.exceptions import BadRequestError, NotFoundError
from src.models.core import AIModelConfig
from src.repositories.ai_model_config import AIModelConfigRepository
from src.schemas.ai_model_config import (
    AIModelConfigCreateRequest,
    AIModelConfigResponse,
    AIModelConfigTestRequest,
    AIModelConfigTestResponse,
    AIModelConfigUpdateRequest,
)


class AIModelConfigService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = AIModelConfigRepository(db)

    async def create(self, data: AIModelConfigCreateRequest) -> AIModelConfigResponse:
        if data.is_default:
            await self.repo.clear_default(data.purpose)

        config = await self.repo.create(data.model_dump())
        await self.db.commit()
        await self.db.refresh(config)
        return AIModelConfigResponse.model_validate(config)

    async def list_by_purpose(self, purpose: str) -> list[AIModelConfigResponse]:
        configs = await self.repo.list_by_purpose(purpose)
        return [AIModelConfigResponse.model_validate(c) for c in configs]

    async def list_all(self) -> list[AIModelConfigResponse]:
        configs = await self.repo.list_all()
        return [AIModelConfigResponse.model_validate(c) for c in configs]

    async def get_by_id(self, config_id: uuid.UUID) -> AIModelConfigResponse:
        config = await self.repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("AI model config not found")
        return AIModelConfigResponse.model_validate(config)

    async def update(
        self, config_id: uuid.UUID, data: AIModelConfigUpdateRequest
    ) -> AIModelConfigResponse:
        config = await self.repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("AI model config not found")

        update_data = {k: v for k, v in data.model_dump().items() if v is not None}
        updated = await self.repo.update(config_id, update_data)
        await self.db.commit()
        await self.db.refresh(updated)
        return AIModelConfigResponse.model_validate(updated)

    async def delete(self, config_id: uuid.UUID) -> None:
        config = await self.repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("AI model config not found")
        if config.is_default:
            raise BadRequestError("Cannot delete the default model config")
        await self.repo.delete(config_id)
        await self.db.commit()

    async def set_default(self, config_id: uuid.UUID) -> AIModelConfigResponse:
        config = await self.repo.get_by_id(config_id)
        if not config:
            raise NotFoundError("AI model config not found")

        await self.repo.clear_default(config.purpose)
        updated = await self.repo.update(config_id, {"is_default": True})
        await self.db.commit()
        await self.db.refresh(updated)
        return AIModelConfigResponse.model_validate(updated)

    async def get_for_chat_service(self, config_id: uuid.UUID) -> AIModelConfig | None:
        """Return the raw ORM model for use in ChatService."""
        return await self.repo.get_by_id(config_id)

    async def test_config(self, data: AIModelConfigTestRequest) -> AIModelConfigTestResponse:
        # If no api_key provided and config_id given, load the stored key
        api_key = data.api_key
        if not api_key and data.config_id:
            config = await self.repo.get_by_id(data.config_id)
            if config:
                api_key = config.api_key

        model_str = build_litellm_model(data.provider, data.model_name)

        try:
            if data.purpose == "embedding":
                import litellm

                kwargs: dict = {}
                if api_key:
                    kwargs["api_key"] = api_key
                if data.base_url:
                    kwargs["api_base"] = data.base_url
                if data.extra_config:
                    kwargs.update(data.extra_config)

                response = await litellm.aembedding(
                    model=model_str,
                    input=["test"],
                    **kwargs,
                )
                dim = len(response.data[0]["embedding"])
                expected_dim = get_settings().qdrant_vector_size
                if dim != expected_dim:
                    return AIModelConfigTestResponse(
                        success=False,
                        message=(
                            f"Embedding dim {dim} does not match QDRANT_VECTOR_SIZE "
                            f"{expected_dim}. Choose a compatible model or update .env."
                        ),
                        response_preview=f"vector dim={dim}, expected={expected_dim}",
                    )
                preview = f"OK — vector dim={dim}"
            else:
                from langchain_community.chat_models import ChatLiteLLM
                from langchain_core.messages import HumanMessage

                kwargs = {"streaming": False}
                if api_key:
                    kwargs["api_key"] = api_key
                if data.base_url:
                    kwargs["api_base"] = data.base_url
                if data.extra_config:
                    kwargs.update(data.extra_config)

                llm = ChatLiteLLM(model=model_str, **kwargs)
                response = await llm.ainvoke([HumanMessage(content="Say 'ok' in one word")])
                preview = response.content.strip()[:100] if hasattr(response, "content") else str(response)[:100]

            return AIModelConfigTestResponse(
                success=True,
                message="Connection successful",
                response_preview=preview,
            )
        except Exception as e:
            return AIModelConfigTestResponse(
                success=False,
                message=str(e)[:300],
                response_preview=None,
            )
