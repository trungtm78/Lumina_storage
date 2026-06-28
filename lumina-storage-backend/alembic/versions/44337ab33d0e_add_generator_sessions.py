"""add generator sessions

Revision ID: 44337ab33d0e
Revises: 00d6ef3cdec8
Create Date: 2026-06-03 10:47:34.587561

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '44337ab33d0e'
down_revision: Union[str, None] = '00d6ef3cdec8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'generator_sessions',
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('template_id', sa.UUID(), nullable=True),
        sa.Column('doc_type', sa.String(length=50), nullable=True),
        sa.Column('field_values', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
        sa.Column('status', sa.String(length=20), server_default='draft', nullable=False),
        sa.Column('document_id', sa.UUID(), nullable=True),
        sa.Column('title', sa.String(length=255), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['documents_document.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['template_id'], ['documents_document.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['user_id'], ['users_user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('generator_sessions')
