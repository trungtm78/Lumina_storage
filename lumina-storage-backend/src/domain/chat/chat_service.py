from src.core.background import spawn_background
import json
import logging
import uuid
from collections.abc import AsyncIterator

from langchain_community.chat_models import ChatLiteLLM
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.core.config import Settings
from src.core.exceptions import ForbiddenError, NotFoundError
from src.ai.tracing import fire_and_forget_flush
from src.core.langfuse import get_langfuse_handler
from src.models.chat import ChatMessage, ChatMessageSource, ChatSession
from src.models.user import User
from src.schemas.chat import MessageSourceResponse
from src.models.core import AIModelConfig
from src.domain.chat.agent import (
    AgentDeps,
    AgentResultCollector,
    build_model,
    build_system_prompt,
    convert_history,
    create_agent,
)
from src.services.ai_model_config_service import build_litellm_model
from src.services.chat_permission_service import ChatPermissionService
from src.domain.chat.chat_title_service import generate_title_background
from src.services.document_permission import DocumentPermissionService
from src.services.embedding_service import EmbeddingService
from src.domain.chat.skill_service import SkillService
from src.services.vector_service import VectorService

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_TEMPLATE = """Bạn là trợ lý AI hỗ trợ tìm kiếm và phân tích tài liệu.

Context từ tài liệu liên quan:
{context}

Hướng dẫn trả lời:
- Trả lời dựa vào context được cung cấp.
- Khi sử dụng thông tin từ context, hãy chèn số trích dẫn dạng [1], [2], ... ngay sau thông tin đó để chỉ rõ nguồn.
- Ví dụ: "Givral là một trợ lý AI [1] hỗ trợ phân tích dữ liệu [2]."
- Nếu context không đủ để trả lời, hãy nói rõ."""


# Phase 8 W2.2: _generate_title_background chuyển sang src/services/chat_title_service.py.
# Phase 7: citation builders chuyển sang src/services/citation_service.py (tách god-service).
from src.domain.chat.citation_service import citations_to_sources  # noqa: E402


class ChatService:
    def __init__(self, db: AsyncSession, settings: Settings) -> None:
        self.db = db
        self.settings = settings
        # Embedding + LLM both pull from the admin-configured AIModelConfig at
        # call time. We can't hit the DB synchronously here, so the heavy
        # objects are lazy — see _ensure_embedding_svc and _ensure_llm.
        self._embedding_svc: EmbeddingService | None = None
        self._llm: ChatLiteLLM | None = None
        self._permission = ChatPermissionService(db)
        self.vector_svc = VectorService(settings)
        self.last_sources: list[MessageSourceResponse] = []
        self.prompt = ChatPromptTemplate.from_messages([
            ("system", SYSTEM_PROMPT_TEMPLATE),
            MessagesPlaceholder("history"),
            ("human", "{question}"),
        ])

    async def _ensure_embedding_svc(self) -> EmbeddingService:
        if self._embedding_svc is None:
            self._embedding_svc = await EmbeddingService.from_db_default(self.db)
        return self._embedding_svc

    @property
    def embedding_svc(self) -> EmbeddingService:
        """Backward-compat for callers that read .embedding_svc synchronously.

        Prefer `await self._ensure_embedding_svc()` in new code.
        """
        if self._embedding_svc is None:
            raise RuntimeError(
                "embedding_svc accessed before initialization — "
                "call await self._ensure_embedding_svc() first"
            )
        return self._embedding_svc

    async def _ensure_llm(self) -> ChatLiteLLM:
        if self._llm is None:
            from src.services.ai_model_config_service import get_default_litellm_config

            cfg = await get_default_litellm_config(self.db, "chat")
            kwargs: dict = {"model": cfg.model, "streaming": True}
            if cfg.api_key:
                kwargs["api_key"] = cfg.api_key
            if cfg.api_base:
                kwargs["api_base"] = cfg.api_base
            self._llm = ChatLiteLLM(**kwargs)
        return self._llm

    @property
    def llm(self) -> ChatLiteLLM:
        if self._llm is None:
            raise RuntimeError(
                "llm accessed before initialization — call await self._ensure_llm() first"
            )
        return self._llm

    async def create_session(self, user_id: uuid.UUID, title: str | None = None) -> ChatSession:
        session = ChatSession(user_id=user_id, title=title)
        self.db.add(session)
        # Phase 3: commit ở boundary (get_db). flush+refresh để có id trả về.
        await self.db.flush()
        await self.db.refresh(session)
        return session

    async def list_sessions(
        self,
        user_id: uuid.UUID,
        limit: int = 20,
        offset: int = 0,
        q: str | None = None,
    ) -> tuple[list[ChatSession], bool]:
        filters = [ChatSession.user_id == user_id, ChatSession.deleted_at.is_(None)]
        if q:
            filters.append(ChatSession.title.ilike(f"%{q}%"))
        result = await self.db.execute(
            select(ChatSession)
            .where(*filters)
            .order_by(ChatSession.created_at.desc())
            .limit(limit + 1)
            .offset(offset)
        )
        rows = list(result.scalars().all())
        has_more = len(rows) > limit
        return rows[:limit], has_more

    async def assert_owned(self, session_id: uuid.UUID, user_id: uuid.UUID) -> ChatSession:
        """Delegate IDOR/ownership check sang ChatPermissionService (P8 W2.1). Giữ method này
        để 4 call-site nội bộ + route gọi `svc.assert_owned(...)` không đổi."""
        return await self._permission.assert_owned(session_id, user_id)

    async def _filter_permitted_documents(self, user, document_ids):
        """Lọc document_ids → chỉ giữ doc user có quyền viewer (chống IDOR document).

        document_ids do client truyền (chat attach) KHÔNG được tin tưởng: chỉ
        những doc người dùng thực sự có quyền xem mới đưa vào RAG/attachment.
        Trả None nếu đầu vào None (để nhánh ACL mặc định chạy)."""
        if not document_ids:
            return document_ids
        perm_svc = DocumentPermissionService(self.db)
        permitted = []
        for did in document_ids:
            try:
                await perm_svc.check_permission(user, document_id=did, required="viewer")
                permitted.append(did)
            except (ForbiddenError, NotFoundError):
                continue  # không quyền / không tồn tại → loại
        dropped = len(document_ids) - len(permitted)
        if dropped:
            # Audit: ghi nhận attempt truy cập doc ngoài quyền (không làm fail request).
            logging.getLogger(__name__).warning(
                "[chat] user %s attached %d document(s) without permission (dropped)",
                getattr(user, "id", "?"), dropped,
            )
        return permitted

    async def get_history(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
        limit: int = 50,
        before_id: uuid.UUID | None = None,
    ) -> tuple[list[ChatMessage], bool]:
        await self.assert_owned(session_id, user_id)
        q = (
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .options(selectinload(ChatMessage.sources).selectinload(ChatMessageSource.document))
        )
        if before_id:
            # Cursor phải thuộc cùng session (chống cursor xuyên session).
            cur = await self.db.execute(
                select(ChatMessage.created_at).where(
                    ChatMessage.id == before_id, ChatMessage.session_id == session_id
                )
            )
            before_ts = cur.scalar_one_or_none()
            if before_ts is not None:
                q = q.where(ChatMessage.created_at < before_ts)
        q = q.order_by(ChatMessage.created_at.desc()).limit(limit + 1)
        result = await self.db.execute(q)
        rows = list(result.scalars().all())
        has_more = len(rows) > limit
        rows = rows[:limit]
        rows.reverse()  # oldest first for display
        return rows, has_more

    async def delete_session(self, session_id: uuid.UUID, user_id: uuid.UUID) -> None:
        await self.assert_owned(session_id, user_id)
        # Collect document IDs from attachments and skill results in this session
        from src.models.document import Document as DocModel
        messages = await self.db.execute(
            select(ChatMessage).where(ChatMessage.session_id == session_id)
        )
        doc_ids_to_delete: set[str] = set()
        for msg in messages.scalars().all():
            # Attachments (user uploaded files)
            if msg.attachments:
                for att in msg.attachments:
                    if att.get("document_id"):
                        doc_ids_to_delete.add(att["document_id"])
            # Skill results (generated files)
            if msg.skill_result:
                if msg.skill_result.get("rendered_document_id"):
                    doc_ids_to_delete.add(msg.skill_result["rendered_document_id"])
                if msg.skill_result.get("preview_pdf_id"):
                    doc_ids_to_delete.add(msg.skill_result["preview_pdf_id"])

        # Delete the session (CASCADE deletes messages)
        await self.db.execute(
            sa_delete(ChatSession).where(ChatSession.id == session_id)
        )

        # Delete associated documents
        if doc_ids_to_delete:
            for doc_id in doc_ids_to_delete:
                try:
                    doc = await self.db.get(DocModel, uuid.UUID(doc_id))
                    if doc:
                        await self.db.delete(doc)
                except Exception:
                    pass

        # Phase 3: commit ở boundary (get_db) — xóa session + docs là MỘT transaction.
        await self.db.flush()

    async def update_session(self, session_id: uuid.UUID, user_id: uuid.UUID, title: str | None) -> ChatSession:
        session = await self.assert_owned(session_id, user_id)
        if title is not None:
            session.title = title
            # Phase 3: commit ở boundary (get_db).
            await self.db.flush()
            await self.db.refresh(session)
        return session

    async def _get_llm(self, model_id: uuid.UUID) -> ChatLiteLLM:
        config = await self.db.get(AIModelConfig, model_id)
        if not config:
            return await self._ensure_llm()

        kwargs: dict = {"streaming": True}
        if config.api_key:
            kwargs["api_key"] = config.api_key
        if config.base_url:
            kwargs["api_base"] = config.base_url
        if config.extra_config:
            kwargs.update(config.extra_config)

        model_str = build_litellm_model(config.provider, config.model_name)
        return ChatLiteLLM(model=model_str, **kwargs)

    # ── Agent mode ────────────────────────────────────────────────────

    async def _save_user_message(
        self, session_id: uuid.UUID, user_message: str, document_ids: list[uuid.UUID] | None
    ) -> ChatMessage:
        """Lưu user message (kèm attachment metadata nếu có document_ids), flush. KHÔNG commit
        (boundary get_db / COMMIT CỐ Ý ở stream_agent). Trích từ stream_agent (P8 W2.3)."""
        attachment_data = None
        if document_ids:
            from src.models.document import Document as DocModel
            attachment_data = []
            for did in document_ids:
                doc = await self.db.get(DocModel, did)
                if doc:
                    attachment_data.append({
                        "document_id": str(doc.id),
                        "filename": doc.original_filename,
                        "extension": doc.extension,
                    })

        user_msg = ChatMessage(
            session_id=session_id, role="user", content=user_message,
            attachments=attachment_data,
        )
        self.db.add(user_msg)
        await self.db.flush()
        return user_msg

    async def stream_agent(
        self,
        session_id: uuid.UUID,
        user_message: str,
        current_user: User,
        document_ids: list[uuid.UUID] | None = None,
        model_id: uuid.UUID | None = None,
    ) -> AsyncIterator[dict]:
        """Stream agent responses using LangGraph ReAct agent with tools."""
        await self.assert_owned(session_id, current_user.id)
        # Lọc document_ids do client truyền theo quyền (chống IDOR document).
        document_ids = await self._filter_permitted_documents(current_user, document_ids)

        # 1. Save user message with attachments (P8 W2.3: helper _save_user_message)
        await self._save_user_message(session_id, user_message, document_ids)

        # 2. Load history
        history_msgs, _ = await self.get_history(session_id, current_user.id)
        lc_history = convert_history(history_msgs)

        # 3. Resolve LLM model (native LangChain, not LiteLLM)
        skill_svc = SkillService(self.settings)
        if model_id:
            model_str, api_key, api_base, api_version, _ = await skill_svc.resolve_model(
                self.db, self.settings, model_id
            )
        else:
            from src.services.ai_model_config_service import get_default_litellm_config

            default_cfg = await get_default_litellm_config(self.db, "chat")
            model_str = default_cfg.model
            api_key = default_cfg.api_key
            api_base = default_cfg.api_base
            api_version = default_cfg.api_version

        llm = build_model(model_str, api_key=api_key, api_base=api_base, api_version=api_version)

        # 4. Build AgentDeps — pass model config so skills use same model as chat
        collector = AgentResultCollector(
            model_override=model_str,
            model_api_key=api_key,
            model_api_base=api_base,
            model_api_version=api_version,
        )
        # Restore cross-turn state from last assistant message
        if history_msgs:
            for msg in reversed(history_msgs):
                if msg.role == "assistant" and msg.skill_result:
                    sr = msg.skill_result
                    if sr.get("skill_state"):
                        collector.skill_state = sr["skill_state"]
                    break

        deps = AgentDeps(
            db=self.db,
            settings=self.settings,
            user=current_user,
            embedding_svc=await self._ensure_embedding_svc(),
            vector_svc=self.vector_svc,
            skill_svc=skill_svc,
            collector=collector,
        )

        # 5. Build system prompt and agent
        system_prompt = await build_system_prompt(deps)
        agent = create_agent(llm)

        # 6. Langfuse tracing
        langfuse_handler = get_langfuse_handler(
            self.settings,
            session_id=str(session_id),
            user_id=str(current_user.id),
        )
        callbacks = [langfuse_handler] if langfuse_handler else []

        # 7. Build input for agent
        # Append attached document info to user message so agent knows about them
        agent_user_message = user_message
        if document_ids:
            from src.models.document import Document as DocModel
            doc_lines = []
            doc_id_list = []
            for did in document_ids:
                doc = await self.db.get(DocModel, did)
                if doc:
                    doc_lines.append(f"- {doc.original_filename} (document_id: {doc.id})")
                    doc_id_list.append(str(doc.id))
            if doc_lines:
                agent_user_message += (
                    "\n\n[Attached files — dùng document_ids khi gọi skill scripts]\n"
                    + "\n".join(doc_lines)
                    + f"\ndocument_ids: {json.dumps(doc_id_list)}"
                )

        input_messages = [SystemMessage(content=system_prompt)] + lc_history + [HumanMessage(content=agent_user_message)]

        config = {
            "configurable": {"deps": deps},
            "callbacks": callbacks,
        }

        # 8. Stream agent events
        full_response = []
        model_used = model_str

        try:
            async for event in agent.astream_events(
                {"messages": input_messages},
                config=config,
                version="v2",
            ):
                kind = event.get("event", "")

                if kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        content = chunk.content
                        # content can be str or list (multi-part: text + tool_calls)
                        if isinstance(content, str) and content:
                            full_response.append(content)
                            yield {"type": "text_delta", "text": content}
                        elif isinstance(content, list):
                            for part in content:
                                if isinstance(part, dict) and part.get("type") == "text" and part.get("text"):
                                    full_response.append(part["text"])
                                    yield {"type": "text_delta", "text": part["text"]}

                elif kind == "on_tool_start":
                    tool_name = event.get("name", "")
                    tool_input = event.get("data", {}).get("input", {})
                    yield {
                        "type": "tool_start",
                        "name": tool_name,
                        "input": tool_input if isinstance(tool_input, dict) else {},
                    }

                elif kind == "on_tool_end":
                    tool_name = event.get("name", "")
                    tool_output = event.get("data", {}).get("output", "")
                    yield {
                        "type": "tool_end",
                        "name": tool_name,
                        "output": str(tool_output)[:2000],
                    }

        except Exception:
            logger.exception("Agent stream error")
            yield {"type": "error", "text": "Agent encountered an error."}

        # 9. Save assistant message
        assistant_content = "".join(full_response)
        if not assistant_content:
            assistant_content = "(agent completed without text output)"

        skill_result_data = None
        if collector.skill_done:
            skill_result_data = {
                "rendered_document_id": collector.skill_done.rendered_document_id,
                "preview_pdf_id": collector.skill_done.preview_pdf_id,
                "applied_count": collector.skill_done.applied_count,
            }
            if collector.skill_state:
                # Cap persisted state at ~1MB so a runaway skill cannot bloat the JSONB column.
                _MAX_STATE_BYTES = 1_000_000
                try:
                    serialized = json.dumps(collector.skill_state, ensure_ascii=False)
                except (TypeError, ValueError):
                    serialized = None
                if serialized is not None and len(serialized.encode("utf-8")) <= _MAX_STATE_BYTES:
                    skill_result_data["skill_state"] = collector.skill_state
                else:
                    logger.warning(
                        "skill_state exceeds %d bytes — dropping to keep ChatMessage row small",
                        _MAX_STATE_BYTES,
                    )
                    skill_result_data["skill_state_truncated"] = True

        assistant_msg = ChatMessage(
            session_id=session_id,
            role="assistant",
            content=assistant_content,
            model_used=model_used,
            skill_result=skill_result_data,
        )
        self.db.add(assistant_msg)
        await self.db.flush()

        # 10. Save sources from collector (rag_search / parse_document _sources).
        # Phase 4 T6: collector.search_results giờ MỘT shape (Citation dict) sau khi xóa
        # query_vector_db → citations_to_sources (dict-only + bỏ entry thiếu document_id).
        for source in citations_to_sources(collector.search_results, assistant_msg.id):
            self.db.add(source)

        # Save ID before expire_all to avoid lazy-load in async context
        assistant_msg_id = assistant_msg.id
        # Phase 3 — COMMIT CỐ Ý (commit-before-background): _generate_title_background
        # spawn ngay sau, đọc ở session riêng → message phải bền trước. Boundary cố ý.
        await self.db.commit()
        # Evict stale ORM objects so selectinload below gets consistent UUID
        # types from asyncpg (expire_on_commit=False means they aren't auto-evicted)
        self.db.expire_all()

        # 11. Build last_sources for SSE
        result = await self.db.execute(
            select(ChatMessageSource)
            .where(ChatMessageSource.message_id == assistant_msg_id)
            .options(selectinload(ChatMessageSource.document))
            .order_by(ChatMessageSource.citation_index)
        )
        sources = list(result.scalars().all())
        self.last_sources = [
            MessageSourceResponse(
                citation_index=s.citation_index,
                document_id=s.document_id,
                document_title=s.document.title if s.document else "",
                original_filename=s.document.original_filename if s.document else "",
                page_number=s.page_number,
                relevance_score=s.relevance_score,
                excerpt=s.excerpt,
            )
            for s in sources
        ]

        # 12. Emit skill_done if applicable
        if collector.skill_done:
            yield {
                "type": "skill_done",
                "data": {
                    "rendered_document_id": collector.skill_done.rendered_document_id,
                    "preview_pdf_id": collector.skill_done.preview_pdf_id,
                    "applied_count": collector.skill_done.applied_count,
                },
            }

        # 13. Flush Langfuse
        # Phase 4 T4: fire-and-forget flush (KHÔNG block response).
        fire_and_forget_flush(langfuse_handler)

        # 14. Auto-generate title — fire-and-forget so stream closes immediately.
        # spawn_background GIỮ ref → tránh asyncio GC huỷ task title giữa chừng (ARCH-P2).
        session = await self.db.get(ChatSession, session_id)
        if session and not session.title:
            spawn_background(
                generate_title_background(session_id, user_message, assistant_content, self.settings),
                name="chat-title",
            )
