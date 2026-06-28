"""phase2 manual edit: edited_html + generator_session_versions

Revision ID: 522ddc12884f
Revises: 39fd1240442b
Create Date: 2026-06-04 11:06:43.106283

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '522ddc12884f'
down_revision: Union[str, None] = '39fd1240442b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) Cột edited_html trên generator_sessions (con trỏ nội dung sửa tay hiện tại)
    op.add_column(
        'generator_sessions',
        sa.Column('edited_html', sa.Text(), nullable=True),
    )

    # 2) Bảng lịch sử version chỉnh sửa tay
    op.create_table(
        'generator_session_versions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('session_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('label', sa.String(length=255), nullable=True),
        sa.Column('edited_html', sa.Text(), nullable=False),
        sa.Column('field_values', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
        sa.Column('created_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', postgresql.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['generator_sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'idx_gen_session_versions_session',
        'generator_session_versions',
        ['session_id', 'version_no'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('idx_gen_session_versions_session', table_name='generator_session_versions')
    op.drop_table('generator_session_versions')
    op.drop_column('generator_sessions', 'edited_html')
