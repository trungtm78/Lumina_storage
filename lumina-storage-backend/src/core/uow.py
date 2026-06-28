"""Unit of Work — một boundary commit/rollback cho cả HTTP và ARQ.

Phase 3: gom commit về MỘT boundary thay vì rải rác ở service/route/worker.

- **HTTP:** `get_db()` (core/database.py) vẫn là boundary auto-commit cuối request.
  `get_uow` cấp một `UnitOfWork` bọc CÙNG session đó — dùng cho commit-trước-enqueue
  tường minh và cho code mới. KHÔNG mở transaction mới (tránh "double boundary").
- **ARQ worker:** `uow_context(session_factory)` tạo session riêng + commit khi thoát
  sạch / rollback khi lỗi — boundary cho mỗi task.

Repository chỉ flush (base.py); UnitOfWork là nơi commit.
"""
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.core.database import AsyncSessionLocal, get_db


class UnitOfWork:
    """Bao một AsyncSession; commit khi thoát sạch, rollback khi có exception.

    Nếu chính `commit()` ở `__aexit__` ném lỗi → rollback rồi propagate (không nuốt),
    để caller biết transaction thất bại thay vì tưởng đã lưu.
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def __aenter__(self) -> "UnitOfWork":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        if exc_type is not None:
            await self.session.rollback()
            return False  # propagate exception gốc
        try:
            await self.session.commit()
        except Exception:
            # Giữ NGUYÊN lỗi commit gốc: nếu rollback cũng lỗi, không để nó che lỗi
            # commit (cái caller thật sự cần biết).
            try:
                await self.session.rollback()
            except Exception:
                pass
            raise
        return False

    async def commit(self) -> None:
        """Commit tường minh — dùng cho commit-TRƯỚC-enqueue (data bền trước khi
        ARQ job được đẩy). Sau commit này KHÔNG nên mutation business thêm trong
        cùng transaction (xem plan Phase 3, quy ước boundary)."""
        await self.session.commit()

    async def rollback(self) -> None:
        await self.session.rollback()

    async def flush(self) -> None:
        await self.session.flush()


async def get_uow(
    session: AsyncSession = Depends(get_db),
) -> AsyncGenerator["UnitOfWork", None]:
    """HTTP dependency: cấp UnitOfWork bọc session của get_db.

    get_db đã sở hữu commit/rollback ở boundary cuối request, nên ở đây chỉ yield
    handle (KHÔNG bọc thêm commit) — route gọi `uow.commit()` khi cần commit-trước-enqueue.
    """
    yield UnitOfWork(session)


@asynccontextmanager
async def uow_context(
    session_factory: async_sessionmaker[AsyncSession] = AsyncSessionLocal,
) -> AsyncGenerator["UnitOfWork", None]:
    """ARQ/background boundary: tạo session riêng từ factory + commit/rollback.

    Dùng trong worker task: `async with uow_context(ctx["session_factory"]) as uow: ...`.
    """
    async with session_factory() as session:
        uow = UnitOfWork(session)
        try:
            yield uow
            await uow.commit()
        except Exception:
            await uow.rollback()
            raise
