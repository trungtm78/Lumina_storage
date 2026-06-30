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


class _WorkerCorrelationFilter(logging.Filter):
    """Gắn request_id (từ correlation-id ContextVar) vào mọi LogRecord của worker.

    Worker dùng stdlib logging (không structlog) → processor _add_correlation_id KHÔNG chạy.
    Filter này đọc ContextVar (worker set từ BackgroundTask.request_id) → log có request_id.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        from asgi_correlation_id.context import correlation_id
        record.request_id = correlation_id.get() or "-"
        return True


def configure_worker_logging(level: int = logging.INFO) -> None:
    """Cấu hình stdlib logging cho worker với request_id (Phase 8 T3)."""
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(name)s %(levelname)s [req=%(request_id)s]: %(message)s")
    )
    handler.addFilter(_WorkerCorrelationFilter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
