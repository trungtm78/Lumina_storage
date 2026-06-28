"""add folder_id to generator_sessions

Revision ID: 39fd1240442b
Revises: 44337ab33d0e
Create Date: 2026-06-03 15:48:27.477860

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '39fd1240442b'
down_revision: Union[str, None] = '44337ab33d0e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Manually trimmed: only add generator_sessions.folder_id.
    # (Autogenerate also flagged unrelated tables/columns because other models are
    #  out of sync with the DB — those drops are intentionally NOT applied here.)
    op.add_column('generator_sessions', sa.Column('folder_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'generator_sessions_folder_id_fkey',
        'generator_sessions', 'documents_folder',
        ['folder_id'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('generator_sessions_folder_id_fkey', 'generator_sessions', type_='foreignkey')
    op.drop_column('generator_sessions', 'folder_id')
