from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin


class User(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    google_id: Mapped[str | None] = mapped_column(String(255), index=True)
    subscription_status: Mapped[str] = mapped_column(
        String(20),
        default="free",
        server_default="free",
        nullable=False,
    )
    credits: Mapped[int] = mapped_column(Integer, default=1000, server_default="1000", nullable=False)
    credits_reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    accounts = relationship("CFAccount", back_populates="user", cascade="all, delete-orphan")
    operation_logs = relationship("OperationLog", back_populates="user", cascade="all, delete-orphan")
    subscriptions = relationship("Subscription", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"User(id={self.id}, email={self.email})"
