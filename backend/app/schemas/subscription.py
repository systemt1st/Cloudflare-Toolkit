from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SubscriptionMe(BaseModel):
    plan_type: Literal["free", "yearly"] | str
    status: str
    start_time: datetime | None = None
    end_time: datetime | None = None


class SubscriptionActivateRequest(BaseModel):
    plan_type: Literal["yearly"] = "yearly"
    days: int = Field(default=365, ge=1, le=3660)


class SubscriptionRedeemRequest(BaseModel):
    code: str = Field(min_length=4, max_length=128)

