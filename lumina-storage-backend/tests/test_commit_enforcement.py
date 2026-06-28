"""Task 3.2 / T2 (enforcement) — chặn `.commit()` tái xuất ở business path không kiểm soát.

Phase 3: commit business phải dồn về BOUNDARY (HTTP get_db / worker uow_context) HOẶC là
checkpoint CỐ Ý (commit-trước-enqueue, status checkpoint session riêng, side-effect mid-
stream). Mọi `.commit()` còn lại trong src/api|worker|services PHẢI có marker giải thích
gần đó. Thêm commit mới không marker → test ĐỎ, buộc reviewer cân nhắc boundary.

Đặt cuối milestone vì khi T3-T5 chưa xong sẽ đỏ do commit cũ còn nguyên.
"""
import re
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"
SCAN_DIRS = ("api", "worker", "services", "ai")  # Phase 4 M6: phủ cả src/ai/ (gateway)

# Marker hợp lệ (so khớp case-insensitive): comment giải thích commit là boundary/
# checkpoint/cố ý (Phase 3 convention).
_MARKERS = tuple(m.lower() for m in (
    "Phase 3",
    "COMMIT CỐ Ý",
    "boundary",
    "commit-trước",
    "commit trước",
    "checkpoint",
    "session riêng",
    "background",
    "status-machine",
    "atomic",
    "uow",
))
_WINDOW = 6  # số dòng phía trên commit được phép chứa marker

_COMMIT_RE = re.compile(r"\.commit\(\)")


def _commit_sites():
    for d in SCAN_DIRS:
        base = SRC / d
        if not base.exists():
            continue
        for py in base.rglob("*.py"):
            lines = py.read_text(encoding="utf-8").splitlines()
            for idx, line in enumerate(lines):
                if _COMMIT_RE.search(line):
                    yield py, idx, lines


def test_no_unsanctioned_commit_in_business_paths():
    violations = []
    for py, idx, lines in _commit_sites():
        window = "\n".join(lines[max(0, idx - _WINDOW): idx + 1])
        if not any(m in window.lower() for m in _MARKERS):
            violations.append(f"{py.relative_to(SRC).as_posix()}:{idx + 1}: {lines[idx].strip()}")
    assert not violations, (
        "Phát hiện .commit() KHÔNG có marker Phase-3 (boundary/checkpoint/cố ý) trong "
        f"{_WINDOW} dòng phía trên.\nPhase 3: commit business phải ở boundary (get_db/"
        "uow_context) hoặc checkpoint CỐ Ý có comment giải thích.\n"
        + "\n".join(violations)
    )


def test_enforcement_actually_detects_unmarked_commit(tmp_path):
    """Kiểm enforcement KHÔNG mù: một file có .commit() trần (không marker) phải bị bắt."""
    bad = tmp_path / "bad.py"
    bad.write_text("async def f(db):\n    await db.commit()\n", encoding="utf-8")
    lines = bad.read_text(encoding="utf-8").splitlines()
    idx = next(i for i, ln in enumerate(lines) if _COMMIT_RE.search(ln))
    window = "\n".join(lines[max(0, idx - _WINDOW): idx + 1])
    assert not any(m in window.lower() for m in _MARKERS)
