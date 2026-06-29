"""Phase 5a Task 3 — hybrid retrieval: vector + FTS chunk-level + RRF fusion.

Giải quyết: R2 (lọc active_ingest_version blue/green — chỉ trả chunk của version đang phục
vụ, bỏ stale/orphan), R5 (ACL nhất quán 2 phía vector+FTS), R6 (NFC query). Là NGUỒN
SearchResult DUY NHẤT cho chat/agent (thay vector_svc.search trực tiếp).

RRF (Reciprocal Rank Fusion, k=60): hợp nhất 2 danh sách xếp hạng (vector similarity + FTS
ts_rank) → recall tốt cho cả semantic lẫn keyword/số/tên riêng.
"""
import unicodedata
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.document import Document as _Doc
from src.models.document import DocumentChunk as _Chunk
from src.services.embedding_service import EmbeddingService
from src.services.vector_service import SearchResult, VectorService

_RRF_K = 60
_OVERFETCH = 4  # lấy top_k * _OVERFETCH mỗi nguồn trước khi fuse → fusion có biên


def _rrf_scores(ranked_lists: list[list], k: int = _RRF_K) -> dict:
    """RRF score mỗi id = sum 1/(k + rank) qua các danh sách (rank bắt đầu 1)."""
    scores: dict = {}
    for lst in ranked_lists:
        for rank, item in enumerate(lst, start=1):
            scores[item] = scores.get(item, 0.0) + 1.0 / (k + rank)
    return scores


def _rrf_fuse(ranked_lists: list[list], k: int = _RRF_K) -> list:
    """Hợp nhất nhiều danh sách id đã xếp hạng → list id theo điểm RRF giảm dần."""
    scores = _rrf_scores(ranked_lists, k)
    return sorted(scores, key=lambda i: scores[i], reverse=True)


class RetrievalService:
    def __init__(
        self, db: AsyncSession, vector_svc: VectorService, embedding_svc: EmbeddingService
    ) -> None:
        self._db = db
        self._vector = vector_svc
        self._embed = embedding_svc

    async def hybrid_search(
        self,
        query: str,
        top_k: int = 5,
        *,
        owner_id: uuid.UUID | None = None,
        acl_doc_ids: list[uuid.UUID] | None = None,
        document_ids: list[uuid.UUID] | None = None,
    ) -> list[SearchResult]:
        """Hybrid vector+FTS, RRF fuse, lọc active-version + ACL. Trả top_k SearchResult."""
        q = unicodedata.normalize("NFC", query) if query else query  # R6
        if not q or not q.strip():
            return []
        n = max(top_k * _OVERFETCH, top_k)

        # 1) Vector (semantic). ACL áp ở Qdrant filter (đã có).
        query_vector = await self._embed.embed_query(q)
        vec = await self._vector.search(
            query_vector, top_k=n, owner_id=owner_id,
            acl_doc_ids=acl_doc_ids, document_ids=document_ids,
        )
        # 2) FTS chunk-level (keyword). ACL + active + unaccent áp trong SQL.
        fts = await self._keyword_search(
            q, n, owner_id=owner_id, acl_doc_ids=acl_doc_ids, document_ids=document_ids
        )
        # 3) RRF fuse theo chunk_id.
        scores = _rrf_scores([[r.chunk_id for r in vec], [r.chunk_id for r in fts]])
        if not scores:
            return []
        # 4) Hydrate + R2 active-filter (1 query GỘP): chỉ giữ chunk có ingest_version ==
        # document.active_ingest_version (bỏ stale/orphan từ cửa sổ swap hoặc crash). Lấy
        # content từ DB (nhất quán). vec có thể chứa chunk stale → bị loại ở đây.
        candidate_ids = list(scores.keys())
        hydrated = await self._hydrate_active(
            candidate_ids, owner_id=owner_id, acl_doc_ids=acl_doc_ids, document_ids=document_ids
        )
        for r in hydrated:
            r.score = scores.get(r.chunk_id, 0.0)
        hydrated.sort(key=lambda r: r.score, reverse=True)
        return hydrated[:top_k]

    async def _keyword_search(
        self, query: str, top_k: int, *, owner_id, acl_doc_ids, document_ids
    ) -> list[SearchResult]:
        tsquery = func.websearch_to_tsquery("simple", func.unaccent(query))
        rank = func.ts_rank(_Chunk.search_vector, tsquery)
        stmt = (
            select(_Chunk.id, _Chunk.document_id, _Chunk.content, _Chunk.page_number, rank.label("rank"))
            .join(_Doc, _Doc.id == _Chunk.document_id)
            .where(_Chunk.search_vector.op("@@")(tsquery))
            .where(_Chunk.ingest_version == _Doc.active_ingest_version)  # R2
            .where(_Doc.deleted_at.is_(None))  # không trả chunk của document soft-deleted
        )
        # R5 ACL — đồng bộ vector_service.search semantics.
        if document_ids is not None and not document_ids:
            return []
        stmt = self._apply_acl(stmt, owner_id, acl_doc_ids, document_ids)
        stmt = stmt.order_by(rank.desc()).limit(top_k)

        rows = (await self._db.execute(stmt)).all()
        return [
            SearchResult(
                chunk_id=row.id, document_id=row.document_id, score=float(row.rank or 0.0),
                content=row.content or "", page_number=row.page_number or 0,
            )
            for row in rows
        ]

    def _apply_acl(self, stmt, owner_id, acl_doc_ids, document_ids):
        """R5 — áp ACL (đồng bộ vector_service.search). Dùng chung FTS + hydrate."""
        if owner_id is not None:
            if acl_doc_ids:
                return stmt.where(or_(_Doc.owner_id == owner_id, _Chunk.document_id.in_(acl_doc_ids)))
            return stmt.where(_Doc.owner_id == owner_id)
        if document_ids is not None:
            return stmt.where(_Chunk.document_id.in_(document_ids))
        return stmt

    async def _hydrate_active(
        self, chunk_ids: list[uuid.UUID], *, owner_id=None, acl_doc_ids=None, document_ids=None
    ) -> list[SearchResult]:
        if not chunk_ids:
            return []
        stmt = (
            select(_Chunk.id, _Chunk.document_id, _Chunk.content, _Chunk.page_number)
            .join(_Doc, _Doc.id == _Chunk.document_id)
            .where(_Chunk.id.in_(chunk_ids))
            .where(_Chunk.ingest_version == _Doc.active_ingest_version)  # R2 lọc active
            # Gate cuối cho MỌI nguồn (gồm vector): bỏ chunk của document soft-deleted (fix leak
            # pre-existing của vector_svc.search vốn không biết deleted_at).
            .where(_Doc.deleted_at.is_(None))
        )
        # ACL gate authoritative DB-side (belt-and-suspenders nếu Qdrant payload ACL drift).
        if document_ids is not None and not document_ids:
            return []
        stmt = self._apply_acl(stmt, owner_id, acl_doc_ids, document_ids)
        rows = (await self._db.execute(stmt)).all()
        return [
            SearchResult(
                chunk_id=row.id, document_id=row.document_id, score=0.0,
                content=row.content or "", page_number=row.page_number or 0,
            )
            for row in rows
        ]
