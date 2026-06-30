"""Phase 6 T1 — is_admin logic thuần ở src/core/authz (gỡ service→api reverse-dep)."""
from types import SimpleNamespace

from src.core.authz import is_admin


def _user(*roles):
    """Dựng user duck-typed: roles = list các is_default (None = role thiếu)."""
    urs = [SimpleNamespace(role=(None if d is None else SimpleNamespace(is_default=d)))
           for d in roles]
    return SimpleNamespace(roles=urs)


def test_is_admin_true_khi_co_role_mac_dinh():
    assert is_admin(_user(False, True)) is True


def test_is_admin_false_khi_khong_role_mac_dinh():
    assert is_admin(_user(False, False)) is False


def test_is_admin_false_khi_roles_rong():
    assert is_admin(_user()) is False


def test_is_admin_bo_qua_role_none():
    assert is_admin(_user(None)) is False
