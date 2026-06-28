"""RAG search — semantic search over user's knowledge base.

Moved from agent's search_documents tool to a skill script.
Agent calls via: run_script("skills/rag-search/tools/search.py", '{"query": "..."}')
"""

from __future__ import annotations


async def run(args: dict, ctx) -> dict:
    """Semantic search with permission filtering."""
    query: str = args.get("query", "")
    top_k: int = args.get("top_k", 5)

    if not query:
        return {"answer": "Cần cung cấp câu truy vấn.", "_sources": []}

    # Embed query
    from src.services.embedding_service import EmbeddingService
    embedding_svc = await EmbeddingService.from_db_default(ctx.db)
    query_vector = await embedding_svc.embed_query(query)

    # Get user permissions
    from src.repositories.document import DocumentRepository
    from src.services.document_permission import DocumentPermissionService

    perm_svc = DocumentPermissionService(ctx.db)
    group_ids = await perm_svc.get_user_group_ids(ctx.user)
    acl_doc_ids = await DocumentRepository(ctx.db).get_acl_only_ids(
        ctx.user.id, group_ids
    )

    # Vector search
    from src.services.vector_service import VectorService
    vector_svc = VectorService(ctx.settings)
    results = await vector_svc.search(
        query_vector=query_vector,
        top_k=top_k,
        owner_id=ctx.user.id,
        acl_doc_ids=acl_doc_ids,
    )

    if not results:
        return {"answer": "Không tìm thấy tài liệu liên quan.", "_sources": []}

    # Format answer with citations
    parts = []
    sources = []
    for i, r in enumerate(results, 1):
        parts.append(f"[{i}] (trang {r.page_number})\n{r.content}")
        sources.append({
            "document_id": str(r.document_id),
            "page_number": r.page_number,
            "content": r.content[:500],
            "score": r.score,
            "citation_index": i,
        })

    return {
        "answer": "\n\n".join(parts),
        "_sources": sources,
    }
