"""seed default Admin role and admin user

Revision ID: 20260407a002
Revises: 20260407a001
Create Date: 2026-04-07

"""
from typing import Sequence, Union
from uuid import UUID

from alembic import op
import sqlalchemy as sa
import bcrypt

revision: str = "20260407a002"
down_revision: Union[str, None] = "20260407a001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ADMIN_ROLE_ID = UUID("00000000-0000-0000-0000-000000000001")
ADMIN_USER_ID = UUID("00000000-0000-0000-0000-000000000002")

DEFAULT_USERNAME = "admin"
DEFAULT_EMAIL = "admin@lumina.com"
DEFAULT_PASSWORD = "Admin@123"


def upgrade() -> None:
    hashed = bcrypt.hashpw(DEFAULT_PASSWORD.encode(), bcrypt.gensalt()).decode()

    # 1. Insert Admin role (is_default=True → recognized as admin by the app)
    op.execute(
        sa.text(
            """
            INSERT INTO users_role (id, name, description, is_default, created_at, updated_at)
            VALUES (:id, 'Admin', 'Default administrator role', true, now(), now())
            ON CONFLICT (name) DO NOTHING
            """
        ).bindparams(id=ADMIN_ROLE_ID)
    )

    # 2. Insert admin user
    op.execute(
        sa.text(
            """
            INSERT INTO users_user (id, username, email, full_name, password, is_active, created_at, updated_at)
            VALUES (:id, :username, :email, 'Administrator', :password, true, now(), now())
            ON CONFLICT (username) DO NOTHING
            """
        ).bindparams(id=ADMIN_USER_ID, username=DEFAULT_USERNAME, email=DEFAULT_EMAIL, password=hashed)
    )

    # 3. Assign admin role to admin user
    op.execute(
        sa.text(
            """
            INSERT INTO users_userrole (user_id, role_id, added_at)
            VALUES (:user_id, :role_id, now())
            ON CONFLICT DO NOTHING
            """
        ).bindparams(user_id=ADMIN_USER_ID, role_id=ADMIN_ROLE_ID)
    )


def downgrade() -> None:
    op.execute(
        sa.text("DELETE FROM users_userrole WHERE user_id = :uid AND role_id = :rid")
        .bindparams(uid=ADMIN_USER_ID, rid=ADMIN_ROLE_ID)
    )
    op.execute(
        sa.text("DELETE FROM users_user WHERE id = :id").bindparams(id=ADMIN_USER_ID)
    )
    op.execute(
        sa.text("DELETE FROM users_role WHERE id = :id").bindparams(id=ADMIN_ROLE_ID)
    )
