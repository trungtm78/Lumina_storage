"""Phase 6 T4 — gate kiến trúc: import-linter phải XANH (chặn route→repo & service→api).

Chạy `lint-imports` (đọc [tool.importlinter] trong pyproject) như subprocess; fail nếu có
contract bị phá → CI/test bắt vi phạm layering tái phát.
"""
import subprocess
from pathlib import Path

# pyproject ở thư mục gốc package (cha của tests/).
_PROJECT_ROOT = Path(__file__).resolve().parent.parent


def test_import_linter_contracts_kept():
    result = subprocess.run(
        ["lint-imports"],
        cwd=_PROJECT_ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        "import-linter phát hiện vi phạm layering:\n" + result.stdout + result.stderr
    )
