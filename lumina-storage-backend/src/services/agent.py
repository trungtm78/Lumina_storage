"""Lumina General AI Agent — LangChain + LangGraph.

Foundational Tools + Dynamic Skills architecture.
Agent reads SKILL.md via read_file, runs scripts via run_script.

Tools: read_file, write_file, list_directory, search_files,
       parse_document, run_script, rag_search
"""

from __future__ import annotations

import importlib.util
import sys
import json
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypedDict

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langchain_openai import AzureChatOpenAI, ChatOpenAI
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import Settings
from src.models.user import User
from src.services.embedding_service import EmbeddingService
from src.services.vector_service import SearchResult, VectorService
from src.services.skill_service import SkillContext, SkillService
from src.services.document_permission import DocumentPermissionService
from src.repositories.document import DocumentRepository

# ── Deps ───────────────────────────────────────────────────────────────


class Citation(TypedDict, total=False):
    """Phase 4 T6 — shape DUY NHẤT cho collector.search_results (1 nguồn citation).

    MỌI điểm set collector.search_results phải dùng shape này: rag_search (vector
    search) + parse_document `_sources` (skill script). total=False → key có thể
    thiếu (skill _sources không bảo đảm đủ); consumer dùng .get() resilient.
    document_id/chunk_id là str (UUID dạng chuỗi)."""
    document_id: str
    chunk_id: str | None
    page_number: int | None
    content: str
    score: float | None


@dataclass
class SkillDoneResult:
    rendered_document_id: str
    preview_pdf_id: str | None = None
    applied_count: int = 0


@dataclass
class AgentResultCollector:
    """Mutable container for tools to communicate results back to SSE route."""
    search_results: list[Citation] = field(default_factory=list)
    skill_done: SkillDoneResult | None = None
    last_script_path: str | None = None
    skill_state: dict = field(default_factory=dict)
    # Model override from user's chat model selection
    model_override: str | None = None
    model_api_key: str | None = None
    model_api_base: str | None = None
    model_api_version: str | None = None


@dataclass
class AgentDeps:
    db: AsyncSession
    settings: Settings
    user: User
    embedding_svc: EmbeddingService
    vector_svc: VectorService
    skill_svc: SkillService
    collector: AgentResultCollector = field(default_factory=AgentResultCollector)


# ── System Prompt ──────────────────────────────────────────────────────


async def build_system_prompt(deps: AgentDeps) -> str:
    """Build system prompt for the RAG search agent."""
    return """Bạn là trợ lý AI hỗ trợ tìm kiếm và tra cứu nội dung tài liệu. LUÔN trả lời bằng tiếng Việt. LUÔN format output bằng Markdown.

## Nguyên tắc
- **KHÔNG tự bịa dữ liệu** — chỉ trả lời dựa trên kết quả từ tool `rag_search`.
- **MỌI câu hỏi về số liệu, sự kiện, nội dung tài liệu** (doanh thu, chi phí, ngày tháng, tên người, điều khoản...) → BẮT BUỘC gọi `rag_search` trước khi trả lời, dù câu hỏi có vẻ đơn giản.
- Nếu `rag_search` không trả về thông tin liên quan → trả lời "Không tìm thấy thông tin trong tài liệu."
- **KHÔNG dùng kiến thức chung hay training data** để trả lời câu hỏi về nội dung tài liệu cụ thể.
- Khi trả lời, trích dẫn bằng ký hiệu [1], [2]... theo thứ tự kết quả tìm kiếm.

## Phong cách trả lời
- Trả lời **tự nhiên, thân thiện** như đang nói chuyện — không dump raw data.
- **KHÔNG hiển thị** document_id, chunk_id, score, hay đường dẫn file cho user.
"""


# ── Helper: extract deps from config ──────────────────────────────────

def _get_deps(config: RunnableConfig) -> AgentDeps:
    """Extract AgentDeps from LangChain RunnableConfig."""
    return config["configurable"]["deps"]


# ── Path jail for tool inputs ─────────────────────────────────────────
#
# These tools take a path argument from the LLM. Without a hard jail, a logged-in
# user can prompt the model into reading or running anything under the app cwd,
# which leaks the seeded admin password, other users' uploads, or — for run_script
# — gives full RCE inside the app container. Both tools below MUST go through
# _resolve_under_skills before touching the filesystem.

_READ_ALLOWED_SUFFIXES = {".md", ".txt", ".json", ".yaml", ".yml"}
_RUN_ALLOWED_SUFFIXES = {".py"}


def _resolve_under_skills(
    settings: Settings,
    user_path: str,
    *,
    allowed_suffixes: set[str],
) -> Path | str:
    """Resolve `user_path` and verify it stays inside the skills directory.

    Returns the resolved Path on success, or an error string on rejection. The
    caller should `isinstance(result, Path)` to check. We intentionally do NOT
    return None on failure so the agent gets a descriptive message back instead
    of an opaque failure mode.
    """
    if not user_path or not user_path.strip():
        return "Path is required"

    # No URLs / schemes / Windows drive letters / NUL bytes
    if any(token in user_path for token in (":", "\x00", "\n", "\r")):
        return f"Path contains forbidden characters: {user_path!r}"

    # Skills root, fully resolved (follows symlinks too)
    skills_root = Path(settings.skills_dir).resolve()
    if not skills_root.exists():
        return f"Skills directory not configured: {settings.skills_dir}"

    candidate = (skills_root / user_path).resolve()

    # The candidate must live INSIDE skills_root. is_relative_to is 3.9+.
    try:
        candidate.relative_to(skills_root)
    except ValueError:
        return (
            f"Path escapes skills directory: {user_path!r}. "
            f"Allowed paths are inside {settings.skills_dir}/."
        )

    suffix = candidate.suffix.lower()
    if suffix not in allowed_suffixes:
        allowed = ", ".join(sorted(allowed_suffixes))
        return f"Suffix {suffix!r} not allowed. Allowed: {allowed}"

    return candidate


def _jail_path(base_dir: Path, path: str) -> Path | None:
    """Resolve `path` (do LLM cung cấp) trong `base_dir`, chặn path traversal.

    Trả về target đã resolve nếu nằm TRONG base_dir; None nếu thoát ra ngoài
    (vd "../../..", đường dẫn tuyệt đối). Khác `_resolve_under_skills` ở chỗ jail
    theo base_dir tùy ý (search_files dùng skills_dir.parent) và không kiểm suffix
    vì đầu vào là thư mục, không phải file. `base_dir` PHẢI đã resolve sẵn.
    """
    try:
        target = (base_dir / path).resolve()
        target.relative_to(base_dir)
    except (ValueError, OSError, RuntimeError):
        # ValueError: thoát ra ngoài base_dir. OSError/RuntimeError: symlink loop
        # hoặc trạng thái fs xấu khi resolve(). Mọi trường hợp → None (opaque).
        return None
    return target


# ── Tool 1: read_file ─────────────────────────────────────────────────

@tool
async def read_instruction(path: str, config: RunnableConfig) -> str:
    """Đọc file hướng dẫn (SKILL.md, README.md...) của một skill.
    Dùng để hiểu cách sử dụng skill trước khi gọi run_script.

    Args:
        path: Đường dẫn tương đối từ skills/ (vd: "docx-form-fill/SKILL.md").
              Không được dùng "..", không được trỏ ra ngoài skills/.
    """
    deps = _get_deps(config)

    # Match the run_script convention: the system prompt and the agent's training
    # data both speak in terms of "skills/<name>/SKILL.md". Strip the prefix so
    # the jail (which is relative to skills_root) works with that input shape.
    raw_path = path
    if raw_path.startswith("skills/") or raw_path.startswith("skills\\"):
        raw_path = raw_path.split("/", 1)[1] if "/" in raw_path else raw_path.split("\\", 1)[1]

    resolved = _resolve_under_skills(
        deps.settings, raw_path, allowed_suffixes=_READ_ALLOWED_SUFFIXES
    )
    if isinstance(resolved, str):
        return resolved  # error message to LLM
    if not resolved.exists() or not resolved.is_file():
        return f"File not found: {path}"
    try:
        content = resolved.read_text(encoding="utf-8")
        return f"## {path}\n\n{content[:6000]}"
    except Exception as e:
        return f"Error reading {path}: {e}"


# ── Tool 2: write_file ────────────────────────────────────────────────

@tool
async def write_file(
    filename: str,
    content: str,
    source_document_id: str = "",
    config: RunnableConfig = None,
) -> str:
    """Ghi file mới vào workspace.

    Args:
        filename: Tên file output (e.g. "report.txt").
        content: Nội dung file (text).
        source_document_id: UUID document gốc (optional).
    """
    deps = _get_deps(config)
    skill_ctx = SkillContext(db=deps.db, settings=deps.settings, user=deps.user)
    data = content.encode("utf-8")

    try:
        if source_document_id:
            doc_id = await skill_ctx.save_rendered_document(data, source_document_id, filename_suffix="")
        else:
            from src.models.document import Document
            from src.services.storage import get_storage_backend
            from src.models.storage import StorageConfig

            result = await deps.db.execute(sa_text("SELECT id FROM storage_storageconfig LIMIT 1"))
            row = result.fetchone()
            if not row:
                return json.dumps({"error": "No storage config found"})

            storage_cfg = await deps.db.get(StorageConfig, row[0])
            backend = get_storage_backend(storage_cfg)
            save_result = await backend.save(data, filename)

            ext = Path(filename).suffix.lstrip(".")
            new_doc = Document(
                title=Path(filename).stem,
                file_name=save_result.file_name,
                original_filename=filename,
                file_path=save_result.file_path,
                file_size=save_result.file_size,
                mime_type="text/plain",
                extension=ext,
                checksum=save_result.checksum,
                storage_config_id=storage_cfg.id,
                owner_id=deps.user.id,
            )
            deps.db.add(new_doc)
            await deps.db.flush()
            await deps.db.refresh(new_doc)
            # Phase 3 — COMMIT CỐ Ý: tool save_document phải bền NGAY (side-effect độc
            # lập), không bị rollback nếu bước agent sau trong cùng stream lỗi. Boundary cố ý.
            await deps.db.commit()
            doc_id = new_doc.id

        return json.dumps({"document_id": str(doc_id), "filename": filename})
    except Exception as e:
        return json.dumps({"error": str(e)})


# ── Tool 3: list_directory ─────────────────────────────────────────────

@tool
async def list_directory(
    extensions: str = "",
    q: str = "",
    config: RunnableConfig = None,
) -> str:
    """Liệt kê hoặc tìm kiếm files trong workspace của user.

    Args:
        extensions: Filter theo đuôi file, phân cách bằng dấu phẩy (vd: ".docx,.xlsx"). Để trống = tất cả.
        q: Tìm kiếm theo tên file (optional). Để trống = liệt kê tất cả.
    """
    deps = _get_deps(config)

    ext_filter = [e.strip().lstrip(".") for e in extensions.split(",") if e.strip()] if extensions else []

    conditions = [
        "owner_id = :uid",
        "deleted_at IS NULL",
        "(source_type IS NULL OR source_type NOT IN ('skill_temp', 'template'))",
    ]
    params: dict = {"uid": deps.user.id}

    if ext_filter:
        all_exts = ext_filter + [f".{e}" for e in ext_filter]
        conditions.append("extension = ANY(:exts)")
        params["exts"] = all_exts

    if q:
        conditions.append("(title ILIKE :q OR original_filename ILIKE :q)")
        params["q"] = f"%{q}%"

    where = " AND ".join(conditions)
    result = await deps.db.execute(
        sa_text(
            f"SELECT id, title, original_filename, extension "
            f"FROM documents_document "
            f"WHERE {where} "
            f"ORDER BY updated_at DESC LIMIT 20"
        ),
        params,
    )

    rows = result.fetchall()
    if not rows:
        return "Workspace trống." if not q else f"Không tìm thấy file matching '{q}'."

    lines = ["Workspace files:"]
    for r in rows:
        lines.append(f"- **{r[1]}** (id=`{r[0]}`, file={r[2]}, ext={r[3]})")
    return "\n".join(lines)


# ── Tool 4: search_files ──────────────────────────────────────────────

@tool
async def search_files(
    query: str,
    path: str = "workspace",
    config: RunnableConfig = None,
) -> str:
    """Tìm file theo tên hoặc pattern.

    Args:
        query: Tên file, keyword, hoặc glob pattern.
        path: "workspace" (user files) hoặc relative path.
    """
    deps = _get_deps(config)

    if path == "workspace":
        result = await deps.db.execute(
            sa_text(
                "SELECT id, title, original_filename, extension "
                "FROM documents_document "
                "WHERE owner_id = :uid AND deleted_at IS NULL "
                "AND (source_type IS NULL OR source_type NOT IN ('skill_temp')) "
                "AND (title ILIKE :q OR original_filename ILIKE :q) "
                "ORDER BY updated_at DESC LIMIT 10"
            ),
            {"uid": deps.user.id, "q": f"%{query}%"},
        )
        rows = result.fetchall()
        if not rows:
            return f"Không tìm thấy file matching '{query}'."
        lines = [f"Search results for '{query}':"]
        for r in rows:
            lines.append(f"- **{r[1]}** (id=`{r[0]}`, file={r[2]})")
        return "\n".join(lines)

    base_dir = Path(deps.settings.skills_dir).parent.resolve()
    # Jail: `path` do LLM cung cấp không được thoát ra ngoài base_dir (path traversal).
    # Trả "Path not found" cho cả trường hợp thoát ra ngoài để không lộ cấu trúc fs.
    target = _jail_path(base_dir, path)
    if target is None or not target.exists():
        return f"Path not found: {path}"

    matches = list(target.rglob(f"*{query}*"))[:20]
    if not matches:
        return f"No files matching '{query}' in {path}."

    lines = [f"Search results in {path}/:"]
    for m in matches:
        rel = m.relative_to(base_dir)
        lines.append(f"- {rel}")
    return "\n".join(lines)


# ── Tool 5: parse_document ────────────────────────────────────────────

@tool
async def parse_document(document_id: str, config: RunnableConfig) -> str:
    """Bóc tách text từ file phức tạp (PDF, Word, Excel).

    Args:
        document_id: UUID document.
    """
    deps = _get_deps(config)
    skill_ctx = SkillContext(db=deps.db, settings=deps.settings, user=deps.user)

    from src.models.document import Document
    doc = await deps.db.get(Document, uuid.UUID(document_id))
    if doc is None:
        return f"Document '{document_id}' không tồn tại."

    ext = Path(doc.original_filename).suffix.lower()

    try:
        doc_bytes = await skill_ctx.get_document_bytes(document_id)
        from markitdown import MarkItDown
        from io import BytesIO
        md = MarkItDown()
        result = md.convert_stream(BytesIO(doc_bytes), file_extension=ext)
        return f"## {doc.original_filename}\n\n{(result.text_content or '')[:8000]}"
    except Exception as e:
        return f"Error parsing {doc.original_filename}: {e}"


# ── Tool 6: run_script ────────────────────────────────────────────────

@tool
async def run_script(
    script_path: str,
    args_json: str = "{}",
    config: RunnableConfig = None,
) -> str:
    """Chạy Python script trong sandbox. Script nhận RuntimeContext (storage, LLM, DB).

    Args:
        script_path: Path tới script (e.g. "skills/docx-form-fill/tools/fill.py").
        args_json: JSON arguments cho script.
    """
    deps = _get_deps(config)

    # Strip a leading "skills/" if the LLM passes the historical convention —
    # _resolve_under_skills jails relative to skills_root, not its parent.
    raw_path = script_path
    if raw_path.startswith("skills/") or raw_path.startswith("skills\\"):
        raw_path = raw_path.split("/", 1)[1] if "/" in raw_path else raw_path.split("\\", 1)[1]

    resolved = _resolve_under_skills(
        deps.settings, raw_path, allowed_suffixes=_RUN_ALLOWED_SUFFIXES
    )
    if isinstance(resolved, str):
        return json.dumps({"error": resolved})

    # Extra rule for executable scripts: must live in <skill>/tools/ — that's the
    # only directory shipped by trusted skill packages. Refuse to execute anything
    # else even if it happens to sit in skills/.
    skills_root = Path(deps.settings.skills_dir).resolve()
    rel_parts = resolved.relative_to(skills_root).parts
    if len(rel_parts) < 3 or rel_parts[1] != "tools":
        return json.dumps({
            "error": f"run_script only executes scripts under skills/<name>/tools/. "
                     f"Got: {script_path}"
        })

    full_path = resolved
    if not full_path.exists():
        return json.dumps({"error": f"Script not found: {script_path}"})

    try:
        args = json.loads(args_json)
    except json.JSONDecodeError:
        return json.dumps({"error": f"Invalid JSON: {args_json[:200]}"})

    # Auto-inject cross-turn state
    if deps.collector.skill_state:
        args.setdefault("_state", deps.collector.skill_state)

    # Resolve model: skill config > chat model > default
    model_override = getattr(deps.collector, "model_override", None)
    model_api_key = getattr(deps.collector, "model_api_key", None)
    model_api_base = getattr(deps.collector, "model_api_base", None)
    model_api_version = getattr(deps.collector, "model_api_version", None)

    # Check per-skill model config — derive skill name from the JAILED resolved path
    # (rel_parts[0] is the skill folder under skills_root) so it stays authoritative
    # even if the LLM passed a weird input shape.
    skill_name = rel_parts[0] if rel_parts else None

    admin_configured = False
    if skill_name:
        try:
            from src.services.ai_model_config_service import build_litellm_model
            cfg_result = await deps.db.execute(
                sa_text("SELECT value FROM core_systemconfig WHERE key = 'skill_model_config'")
            )
            cfg_row = cfg_result.fetchone()
            if cfg_row and cfg_row[0]:
                skill_config = cfg_row[0]
                model_config_id = skill_config.get(skill_name)
                if model_config_id:
                    from src.models.core import AIModelConfig
                    mc = await deps.db.get(AIModelConfig, uuid.UUID(model_config_id))
                    if mc and mc.api_key:
                        model_override = build_litellm_model(mc.provider, mc.model_name)
                        model_api_key = mc.api_key
                        model_api_base = mc.base_url
                        model_api_version = (mc.extra_config or {}).get("api_version")
                        admin_configured = True
        except Exception:
            pass  # Fall through to chat model / default

    # If admin didn't configure a specific model, check if vendor specified one in config.json
    if skill_name and not admin_configured:
        try:
            app_config_path = Path(deps.settings.skills_dir) / skill_name / "config.json"
            if app_config_path.exists():
                app_meta = json.loads(app_config_path.read_text(encoding="utf-8"))
                ai_model = app_meta.get("ai_model") or {}
                vendor_model = ai_model.get("model")
                vendor_provider = ai_model.get("provider")
                if vendor_model and vendor_provider:
                    from src.services.ai_model_config_service import build_litellm_model
                    model_override = build_litellm_model(vendor_provider, vendor_model)
                    # API key stays as-is (uses Storage's configured key for that provider)
        except Exception:
            pass

    # Load app config (decrypted) for this skill
    app_config: dict = {}
    if skill_name:
        try:
            from src.services.app_config_service import AppConfigService
            app_cfg_svc = AppConfigService(deps.db, deps.settings)
            app_config = await app_cfg_svc.get_decrypted_config(skill_name)
        except Exception:
            pass  # Fall through with empty config

    skill_ctx = SkillContext(
        db=deps.db, settings=deps.settings, user=deps.user,
        model_override=model_override,
        model_api_key=model_api_key,
        model_api_base=model_api_base,
        model_api_version=model_api_version,
        app_config=app_config,
    )

    # Inline runner only — subprocess/docker modes aren't implemented and would
    # need a SkillContext RPC bridge before they could replace this. 60s timeout
    # covers heavy skills (e.g. Excel ingest with 3k rows) without leaving zombie
    # processes when something hangs.
    from src.services.script_runner import run_script_inline
    runner_result = await run_script_inline(
        full_path,
        args,
        skill_ctx,
        timeout_seconds=60,
    )

    if not runner_result.ok:
        return json.dumps({"error": runner_result.error})

    result = runner_result.result or {}

    # Track skill_done
    if result.get("rendered_document_id"):
        deps.collector.skill_done = SkillDoneResult(
            rendered_document_id=result["rendered_document_id"],
            preview_pdf_id=result.get("preview_pdf_id"),
            applied_count=result.get("applied_count", 0),
        )

    # Track sources — skill script phải trả `_sources` theo shape Citation (xem
    # AgentResultCollector.search_results); consumer chat_service dùng .get() resilient.
    if result.get("_sources"):
        deps.collector.search_results = result["_sources"]

    # Store cross-turn state
    if result.get("_state"):
        deps.collector.skill_state.update(result["_state"])

    deps.collector.last_script_path = script_path

    response = {k: v for k, v in result.items() if not k.startswith("_")}
    return json.dumps(response, ensure_ascii=False)


# ── Tool 8: search_templates ──────────────────────────────────────────

@tool
async def search_templates(
    query: str,
    config: RunnableConfig = None,
) -> str:
    """Tìm template tài liệu đã được extract sẵn. Trả về template_id, danh sách các trường (placeholders) cần điền, và description.
    Khi user hỏi "cần cung cấp thông tin gì" → gọi tool này để lấy danh sách field chính xác từ template.
    Khi điền file → dùng template_id trả về để fill chính xác hơn.

    Args:
        query: Từ khóa tìm kiếm (vd: "hợp đồng thuê nhà", "thuê mặt bằng").
    """
    deps = _get_deps(config)
    result = await deps.db.execute(
        sa_text(
            "SELECT id, title, description, original_filename, source_metadata "
            "FROM documents_document "
            "WHERE owner_id = :uid AND source_type = 'template' AND deleted_at IS NULL "
            "AND (title ILIKE :q OR description ILIKE :q OR original_filename ILIKE :q) "
            "ORDER BY updated_at DESC LIMIT 5"
        ),
        {"uid": deps.user.id, "q": f"%{query}%"},
    )
    rows = result.fetchall()

    if not rows:
        return f"Không tìm thấy template nào matching '{query}'."

    lines = [f"Templates matching '{query}':"]
    for r in rows:
        meta = r[4] or {}
        fields = meta.get("template_fields", [])
        source_doc = meta.get("source_document_id", "")
        desc = r[2] or ""
        lines.append(
            f"- **{r[1]}** (template_id=`{r[0]}`, source_doc=`{source_doc}`, "
            f"fields={len(fields)}, file={r[3]})"
        )
        if desc:
            lines.append(f"  Mô tả: {desc}")
        if fields:
            field_names = [f["placeholder"] for f in fields]
            lines.append(f"  Các trường cần điền: {', '.join(field_names)}")
    return "\n".join(lines)


# ── Built-in RAG Search Tool ───────────────────────────────────────────


@tool
async def rag_search(query: str, top_k: int = 5, config: RunnableConfig = None) -> str:
    """Tìm kiếm thông tin trong tài liệu của user dựa trên câu hỏi tự nhiên.
    Dùng khi user hỏi về số liệu, sự kiện, nội dung, điều khoản hoặc bất kỳ thông tin cụ thể nào trong tài liệu.

    Args:
        query: Câu hỏi hoặc từ khóa cần tìm kiếm.
        top_k: Số kết quả trả về (mặc định 5).
    """
    deps = _get_deps(config)
    query_vector = await deps.embedding_svc.embed_query(query)
    perm_svc = DocumentPermissionService(deps.db)
    group_ids = await perm_svc.get_user_group_ids(deps.user)
    acl_doc_ids = await DocumentRepository(deps.db).get_acl_only_ids(deps.user.id, group_ids)
    results = await deps.vector_svc.search(
        query_vector=query_vector,
        top_k=top_k,
        owner_id=deps.user.id,
        acl_doc_ids=acl_doc_ids,
    )
    if not results:
        return "Không tìm thấy thông tin liên quan trong tài liệu."
    deps.collector.search_results = [
        {
            "document_id": str(r.document_id),
            "chunk_id": str(r.chunk_id),
            "page_number": r.page_number,
            "content": r.content,
            "score": r.score,
        }
        for r in results
    ]
    parts = [f"[{i}] (trang {r.page_number})\n{r.content}" for i, r in enumerate(results, 1)]
    return "\n\n".join(parts)


# ── Agent Factory ──────────────────────────────────────────────────────

TOOLS = [
    rag_search,
]


def create_agent(llm):
    """Create a LangGraph ReAct agent with foundational tools."""
    from langgraph.prebuilt import create_react_agent
    return create_react_agent(llm, TOOLS)


# ── Helpers ────────────────────────────────────────────────────────────


def convert_history(messages: list) -> list[BaseMessage]:
    """Convert ChatMessage ORM objects to LangChain message format."""
    result: list[BaseMessage] = []
    for msg in messages:
        if msg.role == "user":
            result.append(HumanMessage(content=msg.content))
        elif msg.role == "assistant":
            result.append(AIMessage(content=msg.content or ""))
    return result


def build_model(
    model_str: str,
    api_key: str | None = None,
    api_base: str | None = None,
    api_version: str | None = None,
    **extra: str,
):
    """Build a LangChain chat model."""
    if model_str.startswith("azure/"):
        model_name = model_str.removeprefix("azure/")
        return AzureChatOpenAI(
            azure_deployment=model_name,
            azure_endpoint=api_base or "",
            api_key=api_key or "",
            api_version=api_version or "2024-12-01-preview",
        )

    if model_str.startswith("gemini/"):
        model_name = model_str.removeprefix("gemini/")
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=model_name,
            google_api_key=api_key or "",
        )

    if model_str.startswith("anthropic/"):
        model_name = model_str.removeprefix("anthropic/")
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=model_name,
            api_key=api_key or "",
            base_url=api_base or None,
        )

    if model_str.startswith("ollama/"):
        model_name = model_str.removeprefix("ollama/")
        from langchain_ollama import ChatOllama
        return ChatOllama(
            model=model_name,
            base_url=api_base or "http://localhost:11434",
        )

    return ChatOpenAI(
        model=model_str,
        api_key=api_key or "",
        base_url=api_base,
    )
