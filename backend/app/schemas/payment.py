from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class BEpusdtCheckoutRequest(BaseModel):
    plan_type: Literal["yearly"] = "yearly"
    trade_type: str | None = Field(default=None, min_length=3, max_length=32)
    locale: str | None = Field(default=None, min_length=2, max_length=8)


class PaymentCheckoutResponse(BaseModel):
    order_id: str
    trade_id: str
    payment_url: str
    trade_type: str
    amount: float
    currency: str
    token: str
    actual_amount: str
    expires_at: datetime


class PaymentOrderPublic(BaseModel):
    order_id: str
    provider: str
    plan_type: str
    amount: float
    currency: str
    trade_type: str
    status: str

    trade_id: str | None = None
    payment_url: str | None = None
    token: str | None = None
    actual_amount: str | None = None
    expires_at: datetime | None = None
    paid_at: datetime | None = None


class StripeCheckoutRequest(BaseModel):
    plan_type: Literal["yearly"] = "yearly"
    locale: str | None = Field(default=None, min_length=2, max_length=8)


class StripeCheckoutResponse(BaseModel):
    order_id: str
    session_id: str
    checkout_url: str
    expires_at: datetime | None = None
