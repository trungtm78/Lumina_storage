"""merge_heads

Revision ID: 232231c83817
Revises: 522ddc12884f, 20260603b001
Create Date: 2026-06-10 13:40:11.158277

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '232231c83817'
down_revision: Union[str, None] = ('522ddc12884f', '20260603b001')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
