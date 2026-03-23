from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class OtherBatchSettings(BaseModel):
    crawler_hints: bool | None = None
    bot_fight_mode: bool | None = None
    ai_scrape_shield: Literal["block", "only_on_ad_pages", "disabled"] | None = None
    crawler_protection: bool | None = None
    managed_robots_txt: bool | None = None
    http2_to_origin: bool | None = None
    url_normalization: Literal["none", "incoming"] | None = None
    web_analytics: bool | None = None

    http3: bool | None = None
    websockets: bool | None = None
    browser_check: bool | None = None
    hotlink_protection: bool | None = None


class OtherBatchRequest(BaseModel):
    account_id: str
    domains: list[str] = Field(min_length=1)
    settings: OtherBatchSettings

