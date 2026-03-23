from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SpeedBatchSettings(BaseModel):
    brotli: bool | None = None
    rocket_loader: Literal["off", "on", "manual"] | None = None
    speed_brain: bool | None = None
    cloudflare_fonts: bool | None = None
    early_hints: bool | None = None
    zero_rtt: bool | None = None
    polish: Literal["off", "lossless", "lossy"] | None = None
    mirage: bool | None = None


class SpeedBatchRequest(BaseModel):
    account_id: str
    domains: list[str] = Field(min_length=1)
    settings: SpeedBatchSettings

