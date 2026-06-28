"""Task 2.7 — chặn path traversal trong agent search_files.

search_files nhận `path` do LLM cung cấp rồi ghép `base_dir / path` (base_dir =
skills_dir.parent). Không jail → `path="../../.."` hoặc đường dẫn tuyệt đối thoát ra
ngoài base_dir, cho phép liệt kê file ngoài phạm vi cho phép. `_jail_path` phải resolve
và từ chối mọi target không nằm trong base_dir.
"""
from pathlib import Path

from src.services.agent import _jail_path


def test_jail_allows_path_inside_base(tmp_path):
    base = tmp_path.resolve()
    (base / "skills").mkdir()
    result = _jail_path(base, "skills")
    assert result == (base / "skills").resolve()


def test_jail_allows_base_itself(tmp_path):
    base = tmp_path.resolve()
    assert _jail_path(base, ".") == base


def test_jail_rejects_parent_traversal(tmp_path):
    base = (tmp_path / "root").resolve()
    base.mkdir()
    assert _jail_path(base, "../../..") is None
    assert _jail_path(base, "../secret") is None


def test_jail_rejects_absolute_path(tmp_path):
    base = (tmp_path / "root").resolve()
    base.mkdir()
    # Đường dẫn tuyệt đối (pathlib: base / "/etc" → "/etc") phải bị chặn
    assert _jail_path(base, "/etc/passwd") is None
    assert _jail_path(base, str(tmp_path)) is None  # parent của base


def test_jail_rejects_nested_traversal_escape(tmp_path):
    base = (tmp_path / "root").resolve()
    base.mkdir()
    # Thoát ra rồi vòng lại vẫn phải chặn nếu đích cuối ngoài base
    assert _jail_path(base, "sub/../../outside") is None


def test_jail_handles_symlink_loop(tmp_path):
    """Symlink loop KHÔNG được làm _jail_path ném exception (resolve có thể ném
    OSError/RuntimeError tùy OS/Python). Kết quả: None hoặc path vẫn trong base."""
    base = (tmp_path / "root").resolve()
    base.mkdir()
    a = base / "a"
    b = base / "b"
    a.symlink_to(b)
    b.symlink_to(a)
    result = _jail_path(base, "a")  # không được raise
    assert result is None or result.is_relative_to(base)
