from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class PaymentOrder(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "payment_orders"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="bepusdt", server_default="bepusdt")
    order_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    plan_type: Mapped[str] = mapped_column(String(20), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    amount_currency: Mapped[str] = mapped_column(String(8), nullable=False, default="cny", server_default="cny")
    trade_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    trade_id: Mapped[str | None] = mapped_column(String(255), index=True)
    payment_url: Mapped[str | None] = mapped_column(String(1024))
    token: Mapped[str | None] = mapped_column(String(255))
    actual_amount: Mapped[str | None] = mapped_column(String(64))
    block_transaction_id: Mapped[str | None] = mapped_column(String(128))

    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw_notify: Mapped[dict | None] = mapped_column(JSONB)
