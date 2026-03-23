from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CacheBatchSettings(BaseModel):
    cache_level: Literal["basic", "simplified", "aggressive"] | None = None
    browser_cache_ttl: int | None = Field(default=None, ge=0)
    tiered_cache: bool | None = None
    always_online: bool | None = None
    development_mode: bool | None = None


class CacheBatchRequest(BaseModel):
    account_id: str
    domains: list[str] = Field(min_length=1)
    settings: CacheBatchSettings


class CachePurgeRequest(BaseModel):
    account_id: str
    domains: list[str] = Field(min_length=1)
    confirm: bool = False
    files: list[str] | None = None
