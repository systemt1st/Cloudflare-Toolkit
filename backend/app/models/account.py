from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin


class CFAccount(Base, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "cf_accounts"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    credential_type: Mapped[str] = mapped_column(String(20), nullable=False)  # api_token | global_key
    encrypted_credentials: Mapped[str] = mapped_column(Text, nullable=False)

    user = relationship("User", back_populates="accounts")
    domain_caches = relationship("DomainCache", back_populates="account", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"CFAccount(id={self.id}, user_id={self.user_id}, name={self.name})"
