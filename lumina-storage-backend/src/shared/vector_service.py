import logging
import uuid
from dataclasses import dataclass

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import Distance, Filter, FieldCondition, MatchAny, MatchValue, PayloadSchemaType, PointStruct, VectorParams

from src.core.config import Settings

logger = logging.getLogger(__name__)

_UPSERT_BATCH_SIZE = 200  # points per Qdrant upsert request (~32MB limit safe)


@dataclass
class ChunkPoint:
    id: uuid.UUID
    vector: list[float]
    payload: dict


@dataclass
class SearchResult:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    score: float
    content: str
    page_number: int


class VectorService:
    def __init__(self, settings: Settings) -> None:
        self._client = AsyncQdrantClient(url=settings.qdrant_url)
        self._collection = settings.qdrant_collection
        self._vector_size = settings.qdrant_vector_size

    async def ensure_collection(self) -> None:
        exists = await self._client.collection_exists(self._collection)
        if not exists:
            await self._client.create_collection(
                collection_name=self._collection,
                vectors_config=VectorParams(size=self._vector_size, distance=Distance.COSINE),
            )
        for field in ("document_id", "owner_id"):
            await self._client.create_payload_index(
                collection_name=self._collection,
                field_name=field,
                field_schema=PayloadSchemaType.KEYWORD,
            )

    async def upsert_chunks(self, points: list[ChunkPoint]) -> None:
        qdrant_points = [
            PointStruct(id=str(p.id), vector=p.vector, payload=p.payload)
            for p in points
        ]
        total = len(qdrant_points)
        for i in range(0, total, _UPSERT_BATCH_SIZE):
            batch = qdrant_points[i : i + _UPSERT_BATCH_SIZE]
            await self._client.upsert(collection_name=self._collection, points=batch)
            logger.info("[qdrant] upsert %d-%d / %d", i + 1, i + len(batch), total)

    async def search(
        self,
        query_vector: list[float],
        top_k: int = 5,
        document_ids: list[uuid.UUID] | None = None,
        owner_id: uuid.UUID | None = None,
        acl_doc_ids: list[uuid.UUID] | None = None,
    ) -> list[SearchResult]:
        """Search with optional ACL filtering.

        Preferred: pass owner_id + acl_doc_ids for an efficient OR filter:
            owner_id == user  OR  document_id IN [acl_doc_ids]
        Legacy: pass document_ids for a simple MatchAny filter.
        """
        query_filter = None
        if owner_id is not None:
            # Optimized path: owner filter on Qdrant + small ACL list
            should_conditions = [
                FieldCondition(key="owner_id", match=MatchValue(value=str(owner_id)))
            ]
            if acl_doc_ids:
                should_conditions.append(
                    FieldCondition(
                        key="document_id",
                        match=MatchAny(any=[str(did) for did in acl_doc_ids]),
                    )
                )
            query_filter = Filter(should=should_conditions)
        elif document_ids is not None:
            # Legacy path: explicit document_ids list
            if not document_ids:
                return []  # empty list = no accessible docs
            query_filter = Filter(
                must=[
                    FieldCondition(
                        key="document_id",
                        match=MatchAny(any=[str(did) for did in document_ids]),
                    )
                ]
            )

        response = await self._client.query_points(
            collection_name=self._collection,
            query=query_vector,
            limit=top_k,
            query_filter=query_filter,
            with_payload=True,
        )

        results: list[SearchResult] = []
        for hit in response.points:
            payload = hit.payload or {}
            results.append(
                SearchResult(
                    chunk_id=uuid.UUID(payload["chunk_id"]),
                    document_id=uuid.UUID(payload["document_id"]),
                    score=hit.score,
                    content=payload.get("content", ""),
                    page_number=payload.get("page_number", 0),
                )
            )
        return results

    async def backfill_owner_ids(self, owner_to_point_ids: dict[str, list[str]]) -> int:
        """Set owner_id payload on existing points, grouped by owner.
        owner_to_point_ids: {str(owner_id): [str(point_id), ...]}
        Returns total points updated."""
        updated = 0
        for owner_id_str, point_ids in owner_to_point_ids.items():
            # Process in batches of 500 point IDs per API call
            batch_size = 500
            for i in range(0, len(point_ids), batch_size):
                batch = point_ids[i:i + batch_size]
                await self._client.set_payload(
                    collection_name=self._collection,
                    payload={"owner_id": owner_id_str},
                    points=batch,
                )
                updated += len(batch)
        return updated

    async def delete_stale_versions(self, document_id: uuid.UUID, keep_version: str) -> None:
        """Phase 5a blue/green cleanup: xóa MỌI point của document_id có ingest_version
        != keep_version. Gọi SAU khi upsert version mới + swap active → vector cũ phục vụ
        query tới phút chót (không có cửa sổ rỗng); cũng dọn orphan từ run crash trước.

        CẢNH BÁO: caller PHẢI đã ghi `ingest_version=keep_version` vào payload point mới
        TRƯỚC khi gọi (nếu point mới thiếu ingest_version → must_not không khớp → bị XÓA
        nhầm). Hiện chỉ state-machine ingest (Task 2e) gọi, đã set version đủ. Không gọi
        từ luồng cũ delete_by_document."""
        from qdrant_client.models import FilterSelector

        await self._client.delete(
            collection_name=self._collection,
            points_selector=FilterSelector(
                filter=Filter(
                    must=[
                        FieldCondition(key="document_id", match=MatchValue(value=str(document_id)))
                    ],
                    must_not=[
                        FieldCondition(key="ingest_version", match=MatchValue(value=keep_version))
                    ],
                )
            ),
        )

    async def delete_by_document(self, document_id: uuid.UUID) -> None:
        from qdrant_client.models import FilterSelector

        await self._client.delete(
            collection_name=self._collection,
            points_selector=FilterSelector(
                filter=Filter(
                    must=[
                        FieldCondition(
                            key="document_id",
                            match=MatchAny(any=[str(document_id)]),
                        )
                    ]
                )
            ),
        )
