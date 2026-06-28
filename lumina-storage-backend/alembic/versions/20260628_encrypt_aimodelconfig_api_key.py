"""encrypt existing plaintext api_key in core_aimodelconfig

Mã hóa các api_key đang lưu plaintext (trước khi cột dùng EncryptedString).
Idempotent: bỏ qua row đã có prefix 'enc:'. Downgrade no-op (không giải mã ngược
tự động — cần ENCRYPTION_KEY; decrypt_value vẫn passthrough plaintext nếu cần).

Revision ID: 20260628a001
Revises: 20260610a001
Create Date: 2026-06-28
"""
import sqlalchemy as sa
from alembic import op

revision = "20260628a001"
down_revision = "20260610a001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from src.core.encryption import _ENCRYPTED_PREFIX, encrypt_value

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, api_key FROM core_aimodelconfig WHERE api_key IS NOT NULL")
    ).fetchall()
    encrypted = skipped = 0
    for rid, key in rows:
        if key and not key.startswith(_ENCRYPTED_PREFIX):
            conn.execute(
                sa.text("UPDATE core_aimodelconfig SET api_key = :k WHERE id = :id"),
                {"k": encrypt_value(key), "id": rid},
            )
            encrypted += 1
        else:
            skipped += 1  # đã mã hóa hoặc rỗng → bỏ qua (idempotent)
    op.get_context().impl.static_output(
        f"[migration] encrypted {encrypted} api_key(s), skipped {skipped} (already enc/empty)"
    )


def downgrade() -> None:
    # Không giải mã ngược tự động (an toàn): decrypt_value xử lý passthrough khi đọc.
    pass
