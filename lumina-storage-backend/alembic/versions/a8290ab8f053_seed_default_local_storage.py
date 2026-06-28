"""seed_default_local_storage

Revision ID: a8290ab8f053
Revises: 348677ab497b
Create Date: 2026-04-17 14:36:32.009378

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import uuid


# revision identifiers, used by Alembic.
revision: str = 'a8290ab8f053'
down_revision: Union[str, None] = '348677ab497b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Check if a storage config with local backend type already exists
    conn = op.get_bind()
    
    # Check if we already have a default storage config
    res = conn.execute(sa.text("SELECT id FROM storage_storageconfig WHERE is_default = TRUE")).fetchone()
    
    if not res:
        # Check if basic local one exists to promote to default
        res_local = conn.execute(sa.text("SELECT id FROM storage_storageconfig WHERE backend_type = 'local'")).fetchone()
        if res_local:
            conn.execute(sa.text("UPDATE storage_storageconfig SET is_default = TRUE WHERE id = :id"), {"id": res_local[0]})
        else:
            # Insert new default local storage config
            new_id = str(uuid.uuid4())
            conn.execute(
                sa.text("""
                    INSERT INTO storage_storageconfig (id, name, backend_type, config, is_default, is_active, created_at, updated_at)
                    VALUES (:id, 'Local Storage', 'local', '{"base_path": "uploads"}'::jsonb, TRUE, TRUE, NOW(), NOW())
                """),
                {"id": new_id}
            )


def downgrade() -> None:
    # Usually we don't drop configurations on downgrade natively unless required, but for cleanup:
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM storage_storageconfig WHERE name = 'Local Storage' AND backend_type = 'local' AND is_default = TRUE"))
