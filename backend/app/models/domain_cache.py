from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, UUIDPrimaryKeyMixin


class DomainCache(Base, UUIDPrimaryKeyMixin, SoftDeleteMixin):
    __tablename__ = "domain_caches"
    __table_args__ = (
        Index(
            "ix_domain_caches_account_domain_active",
            "account_id",
            "domain",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("cf_accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    domain: Mapped[str] = mapped_column(String(255), nullable=False)
    zone_id: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    name_servers: Mapped[list[str] | None] = mapped_column(ARRAY(String()), nullable=True)
    cached_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    account = relationship("CFAccount", back_populates="domain_caches")
