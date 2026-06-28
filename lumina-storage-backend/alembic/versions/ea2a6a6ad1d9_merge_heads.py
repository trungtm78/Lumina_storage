"""merge heads

Revision ID: ea2a6a6ad1d9
Revises: 20260424a001, a8290ab8f053
Create Date: 2026-04-24 16:08:16.263579

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ea2a6a6ad1d9'
down_revision: Union[str, None] = ('20260424a001', 'a8290ab8f053')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
