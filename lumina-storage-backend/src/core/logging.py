"""Structured JSON logging qua structlog.

Mọi log đi qua đây để có JSON parse được + tự gắn context (request_id từ
correlation-id middleware nhờ merge_contextvars). Gọi configure_logging() một
lần lúc khởi động app.
"""
import logging

import structlog

_configured = False


def _add_correlation_id(logger, method_name, event_dict):
    """Gắn request_id từ correlation-id middleware (nếu có) vào mọi log."""
    from asgi_correlation_id.context import correlation_id
    cid = correlation_id.get()
    if cid:
        event_dict["request_id"] = cid
    return event_dict


def configure_logging(level: int = logging.INFO, force: bool = False) -> None:
    """Cấu hình structlog JSON. Idempotent: chỉ chạy MỘT LẦN (tránh reconfigure
    global khi create_app gọi nhiều lần). Dùng force=True trong test."""
    global _configured
    if _configured and not force:
        return
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            _add_correlation_id,  # gắn request_id từ correlation-id middleware
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.format_exc_info,  # render exc_info thành string, không vỡ JSON
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
    _configured = True


def get_logger(name: str = "app"):
    return structlog.get_logger(name)
