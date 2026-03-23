from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ActivationCode(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "activation_codes"

    code: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    plan_type: Mapped[str] = mapped_column(String(20), nullable=False, default="yearly", server_default="yearly")
    days: Mapped[int] = mapped_column(Integer, nullable=False, default=365, server_default="365")

    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    redeemed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
