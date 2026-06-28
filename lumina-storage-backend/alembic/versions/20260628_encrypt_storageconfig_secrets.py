"""encrypt existing plaintext S3 secrets in storage_storageconfig.config (JSONB)

Mã hóa access_key/secret_key đang lưu plaintext trong cột JSONB `config`
(EncryptedString không áp được cho field nested trong JSONB → field-level encryption).
Idempotent: encrypt_config_secrets bỏ qua giá trị đã có prefix 'enc:'. Downgrade no-op
(decrypt_value passthrough khi đọc; không giải mã ngược tự động cho an toàn).

Revision ID: 20260628a002
Revises: 20260628a001
Create Date: 2026-06-28
"""
import json

import sqlalchemy as sa
from alembic import op

revision = "20260628a002"
down_revision = "20260628a001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from src.core.encryption import encrypt_config_secrets

    # Freeze danh sách field tại thời điểm migration: không phụ thuộc hằng số live
    # STORAGE_SECRET_FIELDS (nếu nó đổi sau này, migration lịch sử vẫn backfill đúng
    # đúng những field nó từng nhắm tới). Thuật toán mã hóa (Fernet) ổn định.
    _SECRET_FIELDS = ("access_key", "secret_key")

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, config FROM storage_storageconfig WHERE config IS NOT NULL")
    ).fetchall()
    encrypted = skipped = 0
    for rid, cfg in rows:
        # JSONB có thể về dạng dict (psycopg2 codec) hoặc str → chuẩn hóa về dict.
        if isinstance(cfg, str):
            cfg = json.loads(cfg)
        if not isinstance(cfg, dict):
            skipped += 1
            continue
        new_cfg = encrypt_config_secrets(cfg, fields=_SECRET_FIELDS)
        if new_cfg != cfg:
            conn.execute(
                sa.text(
                    "UPDATE storage_storageconfig SET config = CAST(:c AS jsonb) WHERE id = :id"
                ),
                {"c": json.dumps(new_cfg), "id": rid},
            )
            encrypted += 1
        else:
            skipped += 1  # không có secret plaintext / đã mã hóa → bỏ qua (idempotent)
    op.get_context().impl.static_output(
        f"[migration] encrypted secrets in {encrypted} storage config(s), "
        f"skipped {skipped} (no plaintext secret / already enc)"
    )


def downgrade() -> None:
    # Không giải mã ngược tự động (an toàn): decrypt_config_secrets xử lý khi đọc.
    pass
