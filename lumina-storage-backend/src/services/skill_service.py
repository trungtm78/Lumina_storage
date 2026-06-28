"""Skills system: load SKILL.md definitions, detect matching skill, run tools."""

from __future__ import annotations

import importlib.util
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import frontmatter
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import Settings
from src.models.user import User
from src.repositories.document import DocumentRepository
from src.services.storage import get_storage_backend


@dataclass
class SkillDefinition:
    """Mirrors Claude Code SKILL.md format."""
    name: str
    description: str                              # AI uses this to decide when to activate
    instructions: str                             # SKILL.md body (pure markdown instructions)
    skill_dir: Path                               # root directory of the skill
    tools_dir: Path                               # path to tools/ scripts

    # Optional Claude Code fields
    disable_model_invocation: bool = False         # true = only user can invoke via command
    user_invocable: bool = True                    # false = hidden from menu, AI can still use
    allowed_tools: list[str] | None = None         # restrict which agent tools skill can use
    paths: list[str] | None = None                 # glob patterns — skill only active for matching files
    model: str | None = None                       # override model when skill runs
    context: str | None = None                     # "fork" = run in subagent

    # Legacy (kept for backward compat, but AI should use description matching)
    triggers: dict | None = None                   # {"extensions": [...]} — optional hint
    tools: list[dict] | None = None                # tool specs from frontmatter — optional
    routing_hint: str | None = None                # one-line rule for when to invoke this skill

    def list_scripts(self) -> list[str]:
        """List available script names in tools/ directory."""
        if not self.tools_dir.exists():
            return []
        return [
            f.stem for f in sorted(self.tools_dir.glob("*.py"))
            if not f.stem.startswith("_")
        ]


@dataclass
class SkillContext:
    db: AsyncSession
    settings: Settings
    user: User
    # Optional model override (from user's chat model selection)
    model_override: str | None = None
    model_api_key: str | None = None
    model_api_base: str | None = None
    model_api_version: str | None = None
    app_config: dict = field(default_factory=dict)

    async def get_document_bytes(self, document_id: str) -> bytes:
        doc = await DocumentRepository(self.db).get_by_id_active(uuid.UUID(document_id))
        if doc is None:
            raise ValueError(f"Document {document_id} not found")
        # Chống IDOR: skill script chỉ đọc được doc mà user có quyền viewer.
        from src.services.document_permission import DocumentPermissionService
        await DocumentPermissionService(self.db).check_permission(
            self.user, document_id=doc.id, required="viewer"
        )
        from src.models.storage import StorageConfig
        storage_cfg = await self.db.get(StorageConfig, doc.storage_config_id)
        if storage_cfg is None:
            raise ValueError("Storage config not found")
        backend = get_storage_backend(storage_cfg)
        return await backend.read(doc.file_path)

    async def save_rendered_document(
        self,
        data: bytes,
        source_document_id: str,
        filename_suffix: str = "_filled",
        mime_type: str | None = None,
        extension: str | None = None,
    ) -> uuid.UUID:
        from src.models.document import Document
        from src.models.storage import StorageConfig

        source_doc = await DocumentRepository(self.db).get_by_id_active(
            uuid.UUID(source_document_id)
        )
        if source_doc is None:
            raise ValueError(f"Source document {source_document_id} not found")

        storage_cfg = await self.db.get(StorageConfig, source_doc.storage_config_id)
        if storage_cfg is None:
            raise ValueError("Storage config not found")

        backend = get_storage_backend(storage_cfg)

        src_path = Path(source_doc.original_filename)
        out_ext = f".{extension}" if extension else src_path.suffix
        out_filename = f"{src_path.stem}{filename_suffix}{out_ext}"

        result = await backend.save(data, out_filename)

        new_doc = Document(
            title=f"{source_doc.title}{filename_suffix}",
            file_name=result.file_name,
            original_filename=out_filename,
            file_path=result.file_path,
            file_size=result.file_size,
            mime_type=mime_type or source_doc.mime_type,
            extension=out_ext.lstrip("."),
            checksum=result.checksum,
            storage_config_id=source_doc.storage_config_id,
            owner_id=self.user.id,
            source_type="skill_temp",
            source_metadata={"source_document_id": str(source_document_id)},
        )
        self.db.add(new_doc)
        await self.db.flush()
        await self.db.refresh(new_doc)
        # Phase 3 — COMMIT CỐ Ý: artifact của skill/script là side-effect phải bền NGAY
        # giữa luồng thực thi (song song agent.py:257 save_document_tool). KHÔNG gỡ.
        await self.db.commit()
        return new_doc.id

    async def llm_call(self, messages: list[dict], response_format: dict | None = None) -> str:
        """Call LLM from within a skill script. Uses user's selected model if available."""
        import litellm

        # Use override model if it has its own api_key, otherwise look up the
        # admin-configured default chat model from DB. No env fallback.
        if self.model_override and self.model_api_key:
            model = self.model_override
            api_key = self.model_api_key
            api_base = self.model_api_base
            api_version = self.model_api_version
        else:
            from src.services.ai_model_config_service import get_default_litellm_config

            cfg = await get_default_litellm_config(self.db, "chat")
            model = cfg.model
            api_key = cfg.api_key
            api_base = cfg.api_base
            api_version = cfg.api_version

        kwargs: dict = {
            "model": model,
            "messages": messages,
            "stream": False,
        }
        if api_key:
            kwargs["api_key"] = api_key
        if api_base:
            kwargs["api_base"] = api_base
        if api_version:
            kwargs["api_version"] = api_version
        if response_format:
            kwargs["response_format"] = response_format
        resp = await litellm.acompletion(**kwargs)
        return resp.choices[0].message.content or ""

    async def convert_to_pdf(self, doc_bytes: bytes, mime_type: str) -> bytes | None:
        """Convert document bytes to PDF via Gotenberg."""
        import httpx
        gotenberg_url = self.settings.gotenberg_url
        if not gotenberg_url:
            return None
        ext_map = {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
            "application/msword": "doc",
            "application/vnd.ms-excel": "xls",
            "application/vnd.ms-powerpoint": "ppt",
        }
        ext = ext_map.get(mime_type, "docx")
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{gotenberg_url}/forms/libreoffice/convert",
                    files={"files": (f"document.{ext}", doc_bytes, mime_type)},
                )
                if resp.status_code == 200:
                    return resp.content
        except Exception:
            pass
        return None

    async def save_pdf_preview(
        self,
        pdf_bytes: bytes,
        source_document_id: str,
    ) -> uuid.UUID:
        """Save a PDF preview alongside the rendered document."""
        from src.models.document import Document
        from src.models.storage import StorageConfig

        source_doc = await DocumentRepository(self.db).get_by_id_active(
            uuid.UUID(source_document_id)
        )
        if source_doc is None:
            raise ValueError(f"Source document {source_document_id} not found")

        storage_cfg = await self.db.get(StorageConfig, source_doc.storage_config_id)
        if storage_cfg is None:
            raise ValueError("Storage config not found")

        backend = get_storage_backend(storage_cfg)
        src_path = Path(source_doc.original_filename)
        out_filename = f"{src_path.stem}_preview.pdf"

        result = await backend.save(pdf_bytes, out_filename)

        new_doc = Document(
            title=f"{source_doc.title}_preview",
            file_name=result.file_name,
            original_filename=out_filename,
            file_path=result.file_path,
            file_size=result.file_size,
            mime_type="application/pdf",
            extension="pdf",
            checksum=result.checksum,
            storage_config_id=source_doc.storage_config_id,
            owner_id=self.user.id,
            source_type="skill_temp",
            source_metadata={"source_document_id": str(source_document_id)},
        )
        self.db.add(new_doc)
        await self.db.flush()
        await self.db.refresh(new_doc)
        # Phase 3 — COMMIT CỐ Ý: artifact PDF preview của skill/script là side-effect phải
        # bền NGAY giữa luồng thực thi (song song agent.py:257). KHÔNG gỡ.
        await self.db.commit()
        return new_doc.id


def _load_skill(skill_dir: Path) -> SkillDefinition | None:
    """Parse SKILL.md frontmatter + body into a SkillDefinition (Claude Code format)."""
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return None
    post = frontmatter.load(str(skill_md))

    # Parse allowed-tools as list
    allowed_tools_raw = post.get("allowed-tools") or post.get("allowed_tools")
    allowed_tools = None
    if allowed_tools_raw:
        if isinstance(allowed_tools_raw, str):
            allowed_tools = allowed_tools_raw.split()
        elif isinstance(allowed_tools_raw, list):
            allowed_tools = allowed_tools_raw

    # Parse paths as list
    paths_raw = post.get("paths")
    paths = None
    if paths_raw:
        if isinstance(paths_raw, str):
            paths = [paths_raw]
        elif isinstance(paths_raw, list):
            paths = paths_raw

    return SkillDefinition(
        name=post.get("name", skill_dir.name),
        description=post.get("description", ""),
        instructions=post.content,
        skill_dir=skill_dir,
        tools_dir=skill_dir / "tools",
        disable_model_invocation=bool(post.get("disable-model-invocation", False)),
        user_invocable=bool(post.get("user-invocable", True)),
        allowed_tools=allowed_tools,
        paths=paths,
        model=post.get("model"),
        context=post.get("context"),
        triggers=post.get("triggers"),
        tools=post.get("tools"),
        routing_hint=post.get("routing_hint") or post.get("routing-hint"),
    )


class SkillService:
    def __init__(self, settings: Settings) -> None:
        self.skills: list[SkillDefinition] = []
        self._skills_dir = Path(settings.skills_dir)
        self._load_skills()

    def _load_skills(self) -> None:
        """Load all skills from the skills directory."""
        self.skills = []
        if self._skills_dir.exists():
            for entry in sorted(self._skills_dir.iterdir()):
                if entry.is_dir():
                    skill = _load_skill(entry)
                    if skill:
                        self.skills.append(skill)

    def reload(self) -> int:
        """Re-scan skills directory. Call after AppSyncService.sync(). Returns count."""
        self._load_skills()
        return len(self.skills)

    def get_by_name(self, name: str) -> SkillDefinition | None:
        """Return skill by name."""
        for skill in self.skills:
            if skill.name == name:
                return skill
        return None

    def detect(self, file_ext: str | None) -> SkillDefinition | None:
        """Return the first skill whose triggers/description match the file extension."""
        if not file_ext:
            return None
        ext = file_ext.lower()
        for skill in self.skills:
            if ext in self.get_supported_extensions(skill):
                return skill
        return None

    @staticmethod
    def get_supported_extensions(skill: SkillDefinition) -> set[str]:
        """Return all extensions this skill supports (with and without dot)."""
        exts: set[str] = set()
        # From triggers.extensions
        if skill.triggers:
            for e in skill.triggers.get("extensions", []):
                e = e.lower()
                exts.add(e if e.startswith(".") else f".{e}")
                exts.add(e.lstrip("."))
        # Fallback: scan description for common extensions
        if not exts:
            import re
            for m in re.findall(r'\.(docx?|xlsx?|pptx?|pdf|csv)', skill.description.lower()):
                exts.add(f".{m}")
                exts.add(m)
        return exts

    def _load_tool_module(self, skill: SkillDefinition, tool_name: str):
        """Dynamically import a tool script from skill's tools/ directory."""
        tool_path = skill.tools_dir / f"{tool_name}.py"
        if not tool_path.exists():
            raise FileNotFoundError(f"Tool script not found: {tool_path}")
        spec = importlib.util.spec_from_file_location(
            f"skills.{skill.name}.{tool_name}", tool_path
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    async def run_tool(
        self,
        skill: SkillDefinition,
        tool_name: str,
        tool_args: dict,
        ctx: SkillContext,
    ) -> dict:
        """Execute a named tool from skill's tools/ directory."""
        module = self._load_tool_module(skill, tool_name)
        return await module.run(tool_args, ctx)

    async def resolve_model(
        self,
        db: AsyncSession,
        settings: Settings,
        model_id: uuid.UUID | None,
    ) -> tuple[str, str | None, str | None, str | None, dict | None]:
        """Return (model_str, api_key, api_base, api_version, extra_config).

        Resolution order:
            1. Explicit model_id (user-picked model for this turn)
            2. Default chat AIModelConfig from DB (is_default=true, purpose=chat)
            3. Env vars (AI_LLM_MODEL, AI_LLM_API_KEY, ...)
        """
        from src.models.core import AIModelConfig
        from src.repositories.ai_model_config import AIModelConfigRepository
        from src.services.ai_model_config_service import build_litellm_model

        config: AIModelConfig | None = None
        if model_id:
            config = await db.get(AIModelConfig, model_id)
        if config is None:
            config = await AIModelConfigRepository(db).get_default_by_purpose("chat")

        if config:
            return (
                build_litellm_model(config.provider, config.model_name),
                config.api_key,
                config.base_url,
                (config.extra_config or {}).get("api_version"),
                config.extra_config,
            )

        # No env fallback — surface the missing config to the caller.
        from src.services.ai_model_config_service import AIModelConfigNotFoundError
        raise AIModelConfigNotFoundError(
            "No default AI model configured for purpose='chat'. "
            "Admin must add one in the AI Model Config admin page."
        )
