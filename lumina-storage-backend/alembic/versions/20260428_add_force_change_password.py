"""add force_change_password to users + flag default admin

Revision ID: 20260428a001
Revises: 20260427a001
Create Date: 2026-04-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260428a001"
down_revision: Union[str, None] = "20260427a001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users_user",
        sa.Column(
            "force_change_password",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    # Flag the seeded admin ONLY if they've never logged in. On a fresh deploy
    # this catches the default Admin@123. On an existing deploy where the admin
    # has already logged in (and presumably rotated their password long ago), we
    # leave them alone — flagging unconditionally would force them to re-change
    # a password they're already happily using and break the UX.
    op.execute(
        sa.text(
            "UPDATE users_user SET force_change_password = true "
            "WHERE id = '00000000-0000-0000-0000-000000000002' "
            "AND last_login IS NULL"
        )
    )


def downgrade() -> None:
    op.drop_column("users_user", "force_change_password")
