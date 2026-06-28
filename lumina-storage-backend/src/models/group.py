import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base


class Group(Base):
    __tablename__ = "groups_group"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[str] = mapped_column(String(10), nullable=False)  # "manual" | "auto"
    is_select_all: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    filter_role_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users_role.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users_user.id", ondelete="SET NULL"))

    members: Mapped[list["GroupMember"]] = relationship("GroupMember", back_populates="group", cascade="all, delete-orphan")
    excludes: Mapped[list["GroupExclude"]] = relationship("GroupExclude", back_populates="group", cascade="all, delete-orphan")


class GroupMember(Base):
    __tablename__ = "groups_groupmember"

    group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("groups_group.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users_user.id", ondelete="CASCADE"), primary_key=True)

    group: Mapped["Group"] = relationship("Group", back_populates="members")


class GroupExclude(Base):
    __tablename__ = "groups_groupexclude"

    group_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("groups_group.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users_user.id", ondelete="CASCADE"), primary_key=True)

    group: Mapped["Group"] = relationship("Group", back_populates="excludes")
