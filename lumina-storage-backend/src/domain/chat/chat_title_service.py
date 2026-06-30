"""Phase 8 (W2.2) — sinh title chat ở background (SESSION RIÊNG). Tách khỏi god-service ChatService.

Code này VỐN ĐÃ đúng (mở AsyncSessionLocal riêng + commit cố ý, KHÔNG dính bug session-reuse
như persist_eval_pdf B3) → move VERBATIM. Thêm seam `_resolve_title_llm` (test patch không gọi
LLM thật) + param `session_factory` injectable (mirror worker test, default AsyncSessionLocal;
spawn-site không đổi). Best-effort: caller spawn asyncio.create_task; lỗi nuốt-log.
"""
import logging
import uuid

from langchain_community.chat_models import ChatLiteLLM
from langchain_core.messages import HumanMessage

from src.core.config import Settings
from src.models.chat import ChatSession
from src.domain.chat.skill_service import SkillService

logger = logging.getLogger(__name__)


async def _resolve_title_llm(db, settings: Settings) -> ChatLiteLLM:
    """Resolve ChatLiteLLM cho title (model default, non-stream, max_tokens=20). Tách để test patch."""
    skill_svc = SkillService(settings)
    model_str, api_key, api_base, _api_version, _extra = (
        await skill_svc.resolve_model(db, settings, model_id=None)
    )
    return ChatLiteLLM(
        model=model_str,
        api_key=api_key,
        api_base=api_base,
        streaming=False,
        max_tokens=20,
    )


async def generate_title_background(
    session_id: uuid.UUID,
    user_msg: str,
    assistant_msg: str,
    settings: Settings,
    *,
    session_factory=None,
) -> None:
    """Generate and save session title in background — uses its own db session
    so the caller's session can be closed without blocking."""
    from src.core.database import AsyncSessionLocal

    sf = session_factory or AsyncSessionLocal
    try:
        async with sf() as db:
            session = await db.get(ChatSession, session_id)
            if not session or session.title:
                return
            title_llm = await _resolve_title_llm(db, settings)
            prompt = (
                f"Generate a short title (max 8 words, no quotes, no punctuation) "
                f"for this conversation:\nUser: {user_msg[:300]}\nAssistant: {assistant_msg[:300]}"
            )
            response = await title_llm.ainvoke([HumanMessage(content=prompt)])
            title = response.content.strip().strip("\"'")
            session.title = title[:100] if title else user_msg[:50]
            # Phase 3: background title task chạy ở SESSION RIÊNG → commit CỐ Ý.
            await db.commit()
    except Exception:
        logger.debug("Background title generation failed", exc_info=True)
