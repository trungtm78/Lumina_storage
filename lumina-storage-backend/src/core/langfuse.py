"""Langfuse tracing via HTTP API.

Bypasses the langfuse SDK (incompatible with Python 3.14 due to Pydantic v1).
Implements a LangChain CallbackHandler that sends traces directly to the
Langfuse ingestion API.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import BaseMessage
from langchain_core.outputs import LLMResult

from src.core.config import Settings

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _serialize_message(m: BaseMessage) -> dict:
    """Serialize a LangChain message to a dict for Langfuse, preserving full content."""
    content = m.content
    if not isinstance(content, str):
        content = json.dumps(content, ensure_ascii=False) if isinstance(content, (list, dict)) else str(content)
    result = {"role": m.type, "content": content}
    if hasattr(m, "tool_calls") and m.tool_calls:
        result["tool_calls"] = [
            {"name": tc.get("name", ""), "args": tc.get("args", {})}
            for tc in m.tool_calls
        ]
    return result


class LangfuseHTTPHandler(BaseCallbackHandler):
    """LangChain callback handler that posts traces to Langfuse via HTTP."""

    def __init__(
        self,
        public_key: str,
        secret_key: str,
        host: str,
        session_id: str | None = None,
        user_id: str | None = None,
    ) -> None:
        super().__init__()
        self.public_key = public_key
        self.secret_key = secret_key
        self.host = host.rstrip("/")
        self.session_id = session_id
        self.user_id = user_id

        self.trace_id = _new_id()
        self._events: list[dict] = []
        self._spans: dict[str, dict] = {}

        self._events.append({
            "id": _new_id(),
            "type": "trace-create",
            "timestamp": _now_iso(),
            "body": {
                "id": self.trace_id,
                "name": "agent-chat",
                "sessionId": self.session_id,
                "userId": self.user_id,
                "timestamp": _now_iso(),
            },
        })

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        span_id = _new_id()
        self._spans[str(run_id)] = {
            "id": span_id,
            "start_time": _now_iso(),
            "model": kwargs.get("invocation_params", {}).get("model", ""),
        }
        self._events.append({
            "id": _new_id(),
            "type": "generation-create",
            "timestamp": _now_iso(),
            "body": {
                "id": span_id,
                "traceId": self.trace_id,
                "name": serialized.get("id", ["unknown"])[-1] if isinstance(serialized.get("id"), list) else "llm",
                "startTime": _now_iso(),
                "model": self._spans[str(run_id)]["model"],
                "input": prompts,
            },
        })

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[BaseMessage]],
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        span_id = _new_id()
        model_name = kwargs.get("invocation_params", {}).get("model", "")
        if not model_name:
            model_name = kwargs.get("invocation_params", {}).get("azure_deployment", "")

        input_messages = []
        for msg_list in messages:
            for m in msg_list:
                input_messages.append(_serialize_message(m))

        self._spans[str(run_id)] = {
            "id": span_id,
            "start_time": _now_iso(),
            "model": model_name,
        }
        self._events.append({
            "id": _new_id(),
            "type": "generation-create",
            "timestamp": _now_iso(),
            "body": {
                "id": span_id,
                "traceId": self.trace_id,
                "name": "chat",
                "startTime": _now_iso(),
                "model": model_name,
                "input": input_messages,
            },
        })

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: uuid.UUID,
        **kwargs: Any,
    ) -> None:
        span = self._spans.get(str(run_id))
        if not span:
            return

        output: Any = None
        usage = {}

        if response.generations:
            gen = response.generations[0]
            if gen:
                g = gen[0]
                if hasattr(g, "message") and g.message:
                    msg = g.message
                    output_parts: dict[str, Any] = {}
                    if msg.content:
                        output_parts["content"] = msg.content
                    if hasattr(msg, "tool_calls") and msg.tool_calls:
                        output_parts["tool_calls"] = [
                            {"name": tc.get("name", ""), "args": tc.get("args", {})}
                            for tc in msg.tool_calls
                        ]
                    output = output_parts if output_parts else msg.content
                else:
                    output = g.text

        if response.llm_output:
            token_usage = response.llm_output.get("token_usage", {})
            if token_usage:
                usage = {
                    "input": token_usage.get("prompt_tokens", 0),
                    "output": token_usage.get("completion_tokens", 0),
                    "total": token_usage.get("total_tokens", 0),
                }

        self._events.append({
            "id": _new_id(),
            "type": "generation-update",
            "timestamp": _now_iso(),
            "body": {
                "id": span["id"],
                "traceId": self.trace_id,
                "endTime": _now_iso(),
                "output": output,
                **({"usage": usage} if usage else {}),
            },
        })

    def on_llm_error(self, error: BaseException, *, run_id: uuid.UUID, **kwargs: Any) -> None:
        span = self._spans.get(str(run_id))
        if not span:
            return
        self._events.append({
            "id": _new_id(),
            "type": "generation-update",
            "timestamp": _now_iso(),
            "body": {
                "id": span["id"],
                "traceId": self.trace_id,
                "endTime": _now_iso(),
                "statusMessage": str(error),
                "level": "ERROR",
            },
        })

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        span_id = _new_id()
        tool_name = serialized.get("name", "tool")

        try:
            input_data = json.loads(input_str) if input_str.startswith("{") else input_str
        except (json.JSONDecodeError, ValueError):
            input_data = input_str

        self._spans[str(run_id)] = {"id": span_id, "start_time": _now_iso()}
        self._events.append({
            "id": _new_id(),
            "type": "span-create",
            "timestamp": _now_iso(),
            "body": {
                "id": span_id,
                "traceId": self.trace_id,
                "name": f"tool:{tool_name}",
                "startTime": _now_iso(),
                "input": input_data,
            },
        })

    def on_tool_end(self, output: Any, *, run_id: uuid.UUID, **kwargs: Any) -> None:
        span = self._spans.get(str(run_id))
        if not span:
            return

        if hasattr(output, "content"):
            output_data = output.content
        elif isinstance(output, str):
            try:
                output_data = json.loads(output) if output.startswith("{") or output.startswith("[") else output
            except (json.JSONDecodeError, ValueError):
                output_data = output
        else:
            output_data = str(output)

        self._events.append({
            "id": _new_id(),
            "type": "span-update",
            "timestamp": _now_iso(),
            "body": {
                "id": span["id"],
                "traceId": self.trace_id,
                "endTime": _now_iso(),
                "output": output_data,
            },
        })

    def on_tool_error(self, error: BaseException, *, run_id: uuid.UUID, **kwargs: Any) -> None:
        span = self._spans.get(str(run_id))
        if not span:
            return
        self._events.append({
            "id": _new_id(),
            "type": "span-update",
            "timestamp": _now_iso(),
            "body": {
                "id": span["id"],
                "traceId": self.trace_id,
                "endTime": _now_iso(),
                "statusMessage": str(error),
                "level": "ERROR",
            },
        })

    def flush(self) -> None:
        """Send all buffered events to Langfuse ingestion API."""
        if not self._events:
            return
        payload = {"batch": self._events}
        try:
            resp = httpx.post(
                f"{self.host}/api/public/ingestion",
                json=payload,
                auth=(self.public_key, self.secret_key),
                timeout=30,
            )
            if resp.status_code >= 400:
                logger.warning("Langfuse ingestion failed: %s %s", resp.status_code, resp.text[:500])
        except Exception:
            logger.warning("Langfuse ingestion error", exc_info=True)
        finally:
            self._events.clear()


def get_langfuse_handler(
    settings: Settings,
    session_id: str | None = None,
    user_id: str | None = None,
) -> LangfuseHTTPHandler | None:
    """Return a LangfuseHTTPHandler if credentials are configured, else None."""
    if not settings.langfuse_public_key or not settings.langfuse_secret_key:
        return None
    return LangfuseHTTPHandler(
        public_key=settings.langfuse_public_key,
        secret_key=settings.langfuse_secret_key,
        host=settings.langfuse_host,
        session_id=session_id,
        user_id=user_id,
    )
