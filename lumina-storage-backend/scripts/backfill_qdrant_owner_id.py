"""
Backfill owner_id into Qdrant payload for all existing indexed document chunks.

Run:
    python scripts/backfill_qdrant_owner_id.py
"""
import asyncio
import sys
from collections import defaultdict
from pathlib import Path

# Ensure project root is in path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from src.core.config import get_settings
from src.models.document import Document, DocumentChunk
from src.services.vector_service import VectorService


async def main() -> None:
    settings = get_settings()

    engine = create_async_engine(settings.database_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Query all chunks that have been indexed (qdrant_point_id is set)
        result = await session.execute(
            select(DocumentChunk.qdrant_point_id, Document.owner_id)
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(DocumentChunk.qdrant_point_id.is_not(None))
        )
        rows = result.all()

    if not rows:
        print("No indexed chunks found.")
        return

    print(f"Found {len(rows)} indexed chunks across documents.")

    # Group point IDs by owner_id
    owner_to_points: dict[str, list[str]] = defaultdict(list)
    for qdrant_point_id, owner_id in rows:
        owner_to_points[str(owner_id)].append(str(qdrant_point_id))

    print(f"Owners: {len(owner_to_points)}")

    vector_svc = VectorService(settings)
    updated = await vector_svc.backfill_owner_ids(dict(owner_to_points))

    print(f"Done. Updated {updated} Qdrant points with owner_id payload.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
