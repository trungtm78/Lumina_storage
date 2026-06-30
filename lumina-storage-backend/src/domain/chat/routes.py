import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import CurrentUser
from src.core.config import get_settings
from src.core.database import get_db
from src.schemas.chat import (
    CreateSessionRequest,
    MessageResponse,
    MessageSourceResponse,
    PaginatedMessagesResponse,
    PaginatedSessionsResponse,
    SendMessageRequest,
    SessionResponse,
    UpdateSessionRequest,
)
from src.domain.chat.chat_service import ChatService

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/sessions", response_model=SessionResponse, status_code=201)
async def create_session(
    body: CreateSessionRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    svc = ChatService(db=db, settings=get_settings())
    session = await svc.create_session(user_id=current_user.id, title=body.title)
    return SessionResponse.model_validate(session)


@router.get("/sessions", response_model=PaginatedSessionsResponse)
async def list_sessions(
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None),
) -> PaginatedSessionsResponse:
    svc = ChatService(db=db, settings=get_settings())
    sessions, has_more = await svc.list_sessions(
        user_id=current_user.id, limit=limit, offset=offset, q=q
    )
    return PaginatedSessionsResponse(
        items=[SessionResponse.model_validate(s) for s in sessions],
        has_more=has_more,
    )


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> None:
    svc = ChatService(db=db, settings=get_settings())
    await svc.delete_session(session_id=session_id, user_id=current_user.id)


@router.patch("/sessions/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: uuid.UUID,
    body: UpdateSessionRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    svc = ChatService(db=db, settings=get_settings())
    session = await svc.update_session(session_id=session_id, user_id=current_user.id, title=body.title)
    return SessionResponse.model_validate(session)


@router.get("/sessions/{session_id}/messages", response_model=PaginatedMessagesResponse)
async def get_messages(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=200),
    before: uuid.UUID | None = Query(default=None),
) -> PaginatedMessagesResponse:
    svc = ChatService(db=db, settings=get_settings())
    messages, has_more = await svc.get_history(
        session_id=session_id, user_id=current_user.id, limit=limit, before_id=before
    )
    items = []
    for m in messages:
        sources = [
            MessageSourceResponse(
                citation_index=s.citation_index,
                document_id=s.document_id,
                document_title=s.document.title if s.document else "",
                original_filename=s.document.original_filename if s.document else "",
                page_number=s.page_number,
                relevance_score=s.relevance_score,
                excerpt=s.excerpt,
            )
            for s in sorted(m.sources, key=lambda x: x.citation_index)
        ]
        msg = MessageResponse(
            id=m.id,
            session_id=m.session_id,
            role=m.role,
            content=m.content,
            model_used=m.model_used,
            created_at=m.created_at,
            sources=sources,
            skill_result=m.skill_result,
            attachments=m.attachments,
        )
        items.append(msg)
    return PaginatedMessagesResponse(items=items, has_more=has_more)


@router.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: uuid.UUID,
    body: SendMessageRequest,
    current_user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    svc = ChatService(db=db, settings=get_settings())
    # Chặn IDOR TRƯỚC khi mở stream → trả 404 sạch thay vì lỗi giữa luồng SSE.
    await svc.assert_owned(session_id, current_user.id)
    return StreamingResponse(
        _agent_event_stream(svc, session_id, body, current_user),
        media_type="text/event-stream",
    )


async def _agent_event_stream(
    svc: ChatService,
    session_id: uuid.UUID,
    body: SendMessageRequest,
    current_user,
) -> AsyncIterator[str]:
    yield f"event: message_start\ndata: {json.dumps({'type': 'message_start'})}\n\n"
    yield f"event: content_block_start\ndata: {json.dumps({'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}})}\n\n"

    async for event in svc.stream_agent(
        session_id=session_id,
        user_message=body.content,
        current_user=current_user,
        document_ids=body.document_ids,
        model_id=body.model_id,
    ):
        event_type = event.get("type", "")

        if event_type == "text_delta":
            data = {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": event["text"]},
            }
            yield f"event: content_block_delta\ndata: {json.dumps(data)}\n\n"

        elif event_type == "tool_start":
            data = {"type": "tool_use_start", "name": event["name"], "input": event.get("input", {})}
            yield f"event: tool_use_start\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

        elif event_type == "tool_end":
            data = {"type": "tool_use_end", "name": event["name"], "output": event.get("output", "")}
            yield f"event: tool_use_end\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

        elif event_type == "skill_done":
            yield f"event: skill_done\ndata: {json.dumps(event['data'], ensure_ascii=False)}\n\n"

        elif event_type == "error":
            data = {"type": "error", "message": event.get("text", "Unknown error")}
            yield f"event: error\ndata: {json.dumps(data)}\n\n"

    yield f"event: content_block_stop\ndata: {json.dumps({'type': 'content_block_stop', 'index': 0})}\n\n"
    yield f"event: message_delta\ndata: {json.dumps({'type': 'message_delta', 'delta': {'stop_reason': 'end_turn'}})}\n\n"
    yield f"event: message_stop\ndata: {json.dumps({'type': 'message_stop'})}\n\n"

    sources_data = [s.model_dump(mode="json") for s in svc.last_sources]
    yield f"event: sources\ndata: {json.dumps({'type': 'sources', 'sources': sources_data})}\n\n"
