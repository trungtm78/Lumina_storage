"""Phase 8 (W4) — re-ingest corpus để áp NFC normalize cho chunk ingest TRƯỚC Phase 5a.

Phase 5a (Task 2c) thêm NFC normalize cho MỌI page lúc ingest. Document ingest TRƯỚC đó có
chunk chưa NFC → search/anchor lệch với query đã NFC. Re-ingest sửa việc đó.

AN TOÀN nhờ blue/green ingest (Phase 5a): mỗi re-ingest sinh ingest_version mới + swap active
tại DB commit + cleanup stale → KHÔNG downtime, crash-safe. dedupe in-flight (Phase 8 T1) chống
double-enqueue. `dry_run=True` (mặc định) CHỈ liệt kê, KHÔNG enqueue.

Chạy:
  # Liệt kê candidate (an toàn, không đụng queue):
  docker compose run --rm test uv run python -m scripts.reingest_nfc
  # Thực thi enqueue re-ingest:
  docker compose run --rm test uv run python -m scripts.reingest_nfc --apply
"""
import asyncio
import uuid

from sqlalchemy import select

from src.core.config import get_settings
from src.models.document import Document
from src.worker.dispatch import dispatch_task


async def reingest_documents(
    doc_ids: list[uuid.UUID] | None = None,
    *,
    dry_run: bool = True,
    arq_pool=None,
    session_factory=None,
) -> dict:
    """Re-ingest các document ĐÃ ingest (active_ingest_version != None, chưa xóa) để áp NFC.

    dry_run=True → chỉ trả {candidates, ids}, KHÔNG enqueue. dry_run=False → dispatch_task
    ingest_document_task cho từng doc (blue/green tự swap active + cleanup) rồi commit BackgroundTask.
    """
    from src.core.database import AsyncSessionLocal

    sf = session_factory or AsyncSessionLocal
    async with sf() as db:
        stmt = select(Document).where(
            Document.deleted_at.is_(None),
            Document.active_ingest_version.isnot(None),
        )
        # `is not None`: allowlist RỖNG ([]) → lọc về 0 doc (KHÔNG nhầm thành cả corpus — codex P2).
        if doc_ids is not None:
            stmt = stmt.where(Document.id.in_(doc_ids))
        docs = (await db.execute(stmt)).scalars().all()

        if dry_run:
            return {"candidates": len(docs), "ids": [str(d.id) for d in docs]}

        if arq_pool is None:
            from arq import create_pool
            from arq.connections import RedisSettings

            arq_pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))

        # `attempted` (KHÔNG phải "enqueued"): dispatch_task có thể trả task IN-FLIGHT sẵn (dedupe
        # Phase 8 T1) → không phải lần nào cũng vào Redis. Đếm số lần dispatch, báo cáo trung thực (codex P2).
        attempted = 0
        for d in docs:
            await dispatch_task(
                arq_pool=arq_pool,
                func_name="ingest_document_task",
                task_name="ingest_document",
                db=db,
                owner_id=d.owner_id,
                related_type="document",
                related_id=d.id,
                document_id=d.id,
            )
            attempted += 1
        # Phase 3 — COMMIT CỐ Ý (script một-lần, ngoài request boundary): persist BackgroundTask
        # đã dispatch trước khi thoát. KHÔNG gỡ.
        await db.commit()
        return {"candidates": len(docs), "attempted": attempted, "ids": [str(d.id) for d in docs]}


if __name__ == "__main__":
    import sys

    apply = "--apply" in sys.argv
    result = asyncio.run(reingest_documents(dry_run=not apply))
    print(("APPLIED " if apply else "DRY-RUN ") + str(result))
