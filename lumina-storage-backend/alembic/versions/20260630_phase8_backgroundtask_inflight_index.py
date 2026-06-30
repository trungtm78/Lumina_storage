"""Phase 8 T1 — partial unique index chống concurrent double-enqueue BackgroundTask.

Chỉ 1 task in-flight (pending/running) cho mỗi (task_name, related_id) → dispatch_task
in-flight dedup atomic (insert thứ 2 → IntegrityError → trả task đang chạy). Tránh nuốt
re-ingest + clobber active_ingest_version (blue/green).

Revision ID: 20260630a001
Revises: 20260629b001
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260630a001"
down_revision: Union[str, None] = "20260629b001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEX = "uq_backgroundtask_inflight"
_TABLE = "processing_backgroundtask"


def upgrade() -> None:
    op.create_index(
        _INDEX,
        _TABLE,
        ["task_name", "related_id"],
        unique=True,
        postgresql_where="status IN ('pending', 'running')",
    )


def downgrade() -> None:
    op.drop_index(_INDEX, table_name=_TABLE)
