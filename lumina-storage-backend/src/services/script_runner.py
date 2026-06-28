"""
Script runner — foundation for sandboxed tool execution.

Current mode: **inline** (runs in-process with SkillContext access).
Future: **subprocess** (isolated process) and **docker** (container with resource limits).

Adds safety features even in inline mode:
  - Timeout enforcement via asyncio.wait_for
  - Blocked import list (detect dangerous imports)
  - Resource tracking (execution time logging)
"""

import asyncio
import importlib.util
import logging
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Dangerous imports that tools should never use
BLOCKED_IMPORTS = {
    "ctypes",           # load arbitrary C libs
    "multiprocessing",  # spawn processes
    "socket",           # raw network access (should go via httpx/api.json whitelist)
    "pickle",           # RCE risk
    "marshal",          # RCE risk
}

# Regex: detect `import X` or `from X import ...` for blocked modules
_BLOCKED_IMPORT_PATTERN = re.compile(
    r"^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))",
    re.MULTILINE,
)


@dataclass
class RunnerResult:
    ok: bool
    result: dict | None = None
    error: str | None = None
    elapsed_ms: int = 0


def scan_blocked_imports(source: str) -> list[str]:
    """Return list of blocked modules found in source code."""
    found = []
    for match in _BLOCKED_IMPORT_PATTERN.finditer(source):
        mod = match.group(1) or match.group(2)
        if mod:
            root = mod.split(".")[0]
            if root in BLOCKED_IMPORTS:
                found.append(root)
    return list(set(found))


async def run_script_inline(
    script_path: Path,
    args: dict,
    ctx: Any,
    timeout_seconds: int = 60,
) -> RunnerResult:
    """Execute a tool script in-process with timeout.

    This is the default runner. Scripts run with full SkillContext access
    (needed by current tools). Future runners may sandbox execution.
    """
    if not script_path.exists():
        return RunnerResult(ok=False, error=f"Script not found: {script_path}")

    # Pre-flight: scan for blocked imports
    try:
        source = script_path.read_text(encoding="utf-8")
        blocked = scan_blocked_imports(source)
        if blocked:
            logger.warning(
                f"Script {script_path.name} uses blocked imports: {blocked}"
            )
            return RunnerResult(
                ok=False,
                error=f"Script uses restricted modules: {', '.join(blocked)}",
            )
    except Exception:
        pass  # Fall through — let import errors surface naturally

    start = time.monotonic()
    try:
        # Invalidate caches so updated helper modules (_helpers.py, etc.) re-import
        importlib.invalidate_caches()
        tools_dir_str = str(script_path.parent)
        for mod_name in list(sys.modules.keys()):
            mod = sys.modules.get(mod_name)
            mod_file = getattr(mod, "__file__", None)
            if mod_file and tools_dir_str in mod_file:
                del sys.modules[mod_name]

        spec = importlib.util.spec_from_file_location(
            f"script.{script_path.stem}", str(script_path)
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        # Run with timeout
        result = await asyncio.wait_for(
            module.run(args, ctx),
            timeout=timeout_seconds,
        )

        elapsed_ms = int((time.monotonic() - start) * 1000)
        if elapsed_ms > timeout_seconds * 800:  # 80% of timeout
            logger.warning(
                f"Script {script_path.name} took {elapsed_ms}ms (approaching timeout)"
            )

        return RunnerResult(ok=True, result=result, elapsed_ms=elapsed_ms)

    except asyncio.TimeoutError:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        logger.error(f"Script {script_path.name} timed out after {timeout_seconds}s")
        return RunnerResult(
            ok=False,
            error=f"Script execution timeout ({timeout_seconds}s)",
            elapsed_ms=elapsed_ms,
        )
    except Exception as exc:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return RunnerResult(
            ok=False,
            error=f"{type(exc).__name__}: {exc}",
            elapsed_ms=elapsed_ms,
        )


# --- Future runners (stubs) ---


class ScriptRunnerNotImplementedError(RuntimeError):
    """Raised when an operator selects a runner mode that isn't actually wired up.

    Previously these modes silently fell through to the inline runner, which gave
    a false sense of sandboxing. We now fail fast so misconfiguration is obvious.
    """


async def run_script_subprocess(
    script_path: Path,
    args: dict,
    ctx: Any,
    timeout_seconds: int = 60,
) -> RunnerResult:
    """Subprocess isolation runner — not implemented yet.

    Tools require SkillContext (DB session, user, embedding service); a real
    subprocess implementation needs an RPC bridge to expose those, which we
    haven't built. Until then, fail loudly instead of pretending to sandbox.
    """
    raise ScriptRunnerNotImplementedError(
        "SCRIPT_RUNNER_MODE=subprocess is not implemented. "
        "Set SCRIPT_RUNNER_MODE=inline (no isolation), or implement the SkillContext RPC bridge."
    )


async def run_script_docker(
    script_path: Path,
    args: dict,
    ctx: Any,
    timeout_seconds: int = 30,
    cpu_limit: float = 0.5,
    memory_mb: int = 256,
) -> RunnerResult:
    """Docker container runner — not implemented yet. See run_script_subprocess."""
    raise ScriptRunnerNotImplementedError(
        "SCRIPT_RUNNER_MODE=docker is not implemented. "
        "Set SCRIPT_RUNNER_MODE=inline (no isolation), or implement the container bridge."
    )


def get_runner(mode: str):
    """Return the runner function for given mode.

    Unknown modes raise instead of silently downgrading — operators should know
    that their isolation policy is not in effect.
    """
    runners = {
        "inline": run_script_inline,
        "subprocess": run_script_subprocess,
        "docker": run_script_docker,
    }
    if mode not in runners:
        raise ScriptRunnerNotImplementedError(
            f"Unknown SCRIPT_RUNNER_MODE='{mode}'. Valid modes: {sorted(runners)}"
        )
    return runners[mode]
