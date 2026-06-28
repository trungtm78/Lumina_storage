import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, SmallInteger, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.models.base import Base, TimestampMixin


class User(TimestampMixin, Base):
    __tablename__ = "users_user"

    username: Mapped[str] = mapped_column(String(150), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, server_default="")
    avatar: Mapped[str | None] = mapped_column(String(512))
    password: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    force_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    locale: Mapped[str] = mapped_column(String(10), nullable=False, server_default="vi")
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    roles: Mapped[list["UserRole"]] = relationship("UserRole", back_populates="user", foreign_keys="UserRole.user_id", passive_deletes=True)


class Role(TimestampMixin, Base):
    __tablename__ = "users_role"

    name: Mapped[str] = mapped_column(String(150), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    members: Mapped[list["UserRole"]] = relationship("UserRole", back_populates="role")
    menu_permissions: Mapped[list["RoleMenuPermission"]] = relationship("RoleMenuPermission", back_populates="role", cascade="all, delete-orphan")


class UserRole(Base):
    __tablename__ = "users_userrole"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users_user.id", ondelete="CASCADE"), primary_key=True)
    role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users_role.id", ondelete="CASCADE"), primary_key=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    added_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users_user.id", ondelete="SET NULL"))

    user: Mapped["User"] = relationship("User", back_populates="roles", foreign_keys=[user_id])
    role: Mapped["Role"] = relationship("Role", back_populates="members")


class MenuPermission(Base):
    __tablename__ = "users_menupermission"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    urlpath: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")


class RoleMenuPermission(Base):
    __tablename__ = "users_rolemenupermission"

    role_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users_role.id", ondelete="CASCADE"), primary_key=True)
    menu_permission_id: Mapped[int] = mapped_column(Integer, ForeignKey("users_menupermission.id", ondelete="CASCADE"), primary_key=True)
    level: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    role: Mapped["Role"] = relationship("Role", back_populates="menu_permissions")
    menu_permission: Mapped["MenuPermission"] = relationship("MenuPermission")
