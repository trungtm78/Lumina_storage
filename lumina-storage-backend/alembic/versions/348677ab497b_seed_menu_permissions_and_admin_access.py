"""seed menu permissions and admin access

Revision ID: 348677ab497b
Revises: 20260408a002
Create Date: 2026-04-17 14:07:17.316378

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '348677ab497b'
down_revision: Union[str, None] = '20260408a002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Remove old 'Apps' and 'Templates' permissions from DB if they were seeded in the past
    op.execute(
        """
        DELETE FROM users_rolemenupermission
        WHERE menu_permission_id IN (
            SELECT id FROM users_menupermission WHERE urlpath IN ('/apps', '/templates')
        );
        """
    )
    op.execute(
        """
        DELETE FROM users_menupermission WHERE urlpath IN ('/apps', '/templates');
        """
    )

    # Insert default menu permissions
    op.execute(
        """
        INSERT INTO users_menupermission (name, urlpath, order_index) VALUES
        ('Documents', '/documents', 1),
        ('Chat AI', '/chat', 2),
        ('Trash', '/trash', 3),
        ('Settings', '/settings', 4),
        ('Users, Groups & Roles', '/users-roles', 5),
        ('Starred', '/starred', 6),
        ('Task Logs', '/tasks', 7)
        ON CONFLICT (urlpath) DO UPDATE SET 
            name = EXCLUDED.name,
            order_index = EXCLUDED.order_index;
        """
    )

    # Insert rolemenupermission for Admin role (is_default=true) with full access (level=2)
    # The Admin role was seeded with ID '00000000-0000-0000-0000-000000000001'
    op.execute(
        """
        INSERT INTO users_rolemenupermission (role_id, menu_permission_id, level)
        SELECT '00000000-0000-0000-0000-000000000001'::uuid, id, 2
        FROM users_menupermission
        ON CONFLICT (role_id, menu_permission_id) DO NOTHING;
        """
    )


def downgrade() -> None:
    pass
