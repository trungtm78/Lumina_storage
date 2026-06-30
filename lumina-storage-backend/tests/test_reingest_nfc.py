"""P8 W4 — scripts/reingest_nfc.py dry-run: liệt kê candidate, KHÔNG enqueue khi dry_run.

Bất biến an toàn cốt lõi: dry_run (mặc định) TUYỆT ĐỐI KHÔNG enqueue task nào → chạy thử an toàn
trên DB thật trước khi --apply. session_factory injectable (mirror worker test).
"""
import pytest
from unittest.mock import AsyncMock, patch

from sqlalchemy.ext.asyncio import async_sessionmaker

from scripts.reingest_nfc import reingest_documents

pytestmark = pytest.mark.asyncio


async def test_dry_run_does_not_enqueue(test_engine):
    sf = async_sessionmaker(test_engine, expire_on_commit=False)
    with patch("scripts.reingest_nfc.dispatch_task", new=AsyncMock()) as disp:
        out = await reingest_documents(dry_run=True, session_factory=sf)
    disp.assert_not_called()  # dry_run TUYỆT ĐỐI không enqueue
    assert "candidates" in out and "ids" in out
    assert isinstance(out["candidates"], int)
    assert out["candidates"] == len(out["ids"])
