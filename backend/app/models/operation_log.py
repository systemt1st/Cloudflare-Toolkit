from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, UUIDPrimaryKeyMixin


class OperationLog(Base, UUIDPrimaryKeyMixin, SoftDeleteMixin):
    __tablename__ = "operation_logs"
    __table_args__ = (Index("ix_operation_logs_user_created", "user_id", "created_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    operation_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_domain: Mapped[str | None] = mapped_column(String(255))
    result: Mapped[str] = mapped_column(String(20), nullable=False)  # success | failed
    details: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )

    user = relationship("User", back_populates="operation_logs")
