import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class AppException(Exception):
    status_code: int = 500
    detail: str = "Internal server error"

    def __init__(self, detail: str | None = None):
        self.detail = detail or self.__class__.detail
        super().__init__(self.detail)


class NotFoundError(AppException):
    status_code = 404
    detail = "Resource not found"


class UnauthorizedError(AppException):
    status_code = 401
    detail = "Unauthorized"


class ForbiddenError(AppException):
    status_code = 403
    detail = "Forbidden"


class ConflictError(AppException):
    status_code = 409
    detail = "Resource already exists"


class BadRequestError(AppException):
    status_code = 400
    detail = "Bad request"


class PayloadTooLargeError(AppException):
    status_code = 413
    detail = "File too large"


def _request_id_headers() -> dict[str, str]:
    """Gắn X-Request-ID vào response lỗi để client truy vết được (kể cả 500)."""
    from asgi_correlation_id.context import correlation_id
    cid = correlation_id.get()
    return {"X-Request-ID": cid} if cid else {}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppException)
    async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail},
                            headers=_request_id_headers())

    @app.exception_handler(ValueError)
    async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
        return JSONResponse(status_code=400, content={"detail": str(exc)},
                            headers=_request_id_headers())

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        # Catch-all: đảm bảo mọi unhandled exception (DB lỗi, asyncpg, v.v.)
        # đều trả JSONResponse — response này đi qua CORSMiddleware đúng cách,
        # tránh lỗi "No Access-Control-Allow-Origin" trên browser.
        logger.error("Unhandled exception on %s %s: %s", request.method, request.url.path, exc, exc_info=True)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"},
                            headers=_request_id_headers())
