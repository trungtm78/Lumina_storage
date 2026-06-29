"""Phase 5b — ExtractionProviderConfig: cấu hình provider trích xuất (admin chọn qua UI).

Mirror AIModelConfig: api_key mã hóa at-rest (EncryptedString), options JSONB (config
non-secret như extra_config), routing theo applies_to (mime/ext) + priority, một default
toàn cục (provider mặc định trước LocalHybrid fallback).
"""
from sqlalchemy import Boolean, Index, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.core.encryption import EncryptedString
from src.models.base import Base, TimestampMixin


class ExtractionProviderConfig(TimestampMixin, Base):
    __tablename__ = "extraction_extractionproviderconfig"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)  # local_hybrid|gemini|mistral|azure_di|landing_ai
    api_key: Mapped[str | None] = mapped_column(EncryptedString)       # credential (mã hóa at-rest)
    base_url: Mapped[str | None] = mapped_column(String(512))          # endpoint (Azure DI, self-host Mistral...)
    options: Mapped[dict | None] = mapped_column(JSONB)                # config non-secret (model, region...)
    applies_to: Mapped[list | None] = mapped_column(JSONB)             # routing: ["application/pdf",".pdf"]; None/["*"]=mọi loại
    priority: Mapped[int] = mapped_column(Integer, nullable=False, server_default="100")  # nhỏ = ưu tiên cao
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    __table_args__ = (
        Index("idx_extractionprovider_active", "is_active", "priority"),
        # Một default TOÀN CỤC (partial unique trên is_default where TRUE).
        Index(
            "uq_extractionprovider_one_default",
            "is_default",
            unique=True,
            postgresql_where="is_default = TRUE",
        ),
    )
