"""enable unaccent + backfill search_vector for Vietnamese FTS

Revision ID: 20260428a002
Revises: 20260428a001
Create Date: 2026-04-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260428a002"
down_revision: Union[str, None] = "20260428a001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The 'simple' tsearch config doesn't stem Vietnamese, but stripping accents
    # via unaccent() lets queries match either accented or unaccented forms.
    #
    # NOTE on permissions: CREATE EXTENSION requires a superuser (or a role with
    # rds_superuser on RDS, etc). On managed Postgres where the app user lacks
    # this, ask the DBA to run `CREATE EXTENSION unaccent;` once — this migration
    # will then no-op the CREATE thanks to IF NOT EXISTS and proceed to backfill.
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")

    # Backfill: re-tokenize all existing document content with unaccent applied.
    # NOTE on perf: this is a full-table UPDATE on documents_documentcontent.
    # ~seconds for <10k rows, ~minutes for 100k+. On large prod DBs run this
    # during a low-traffic window — the row-level write locks aren't shared.
    op.execute(
        """
        UPDATE documents_documentcontent
        SET search_vector = to_tsvector('simple', unaccent(raw_text))
        WHERE raw_text IS NOT NULL
        """
    )


def downgrade() -> None:
    # Re-populate without unaccent so the column matches the old query shape.
    op.execute(
        """
        UPDATE documents_documentcontent
        SET search_vector = to_tsvector('simple', raw_text)
        WHERE raw_text IS NOT NULL
        """
    )
    # We deliberately do NOT drop the unaccent extension — other code may rely on it.
