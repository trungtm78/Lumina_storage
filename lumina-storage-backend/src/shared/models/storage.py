import uuid

from sqlalchemy import Boolean, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.shared.models.base import Base, TimestampMixin


class StorageConfig(TimestampMixin, Base):
    __tablename__ = "storage_storageconfig"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    backend_type: Mapped[str] = mapped_column(String(20), nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    owner_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users_user.id", ondelete="CASCADE")
    )

    __table_args__ = (
        Index(
            "uq_storageconfig_one_default",
            "is_default",
            unique=True,
            postgresql_where="is_default = TRUE",
        ),
    )
