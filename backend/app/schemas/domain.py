from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class DomainCacheItem(BaseModel):
    domain: str
    zone_id: str
    status: str
    name_servers: list[str] | None = None
    cached_at: datetime


class DomainCacheRefreshResponse(BaseModel):
    count: int
    cached_at: datetime


class DomainAddRequest(BaseModel):
    account_id: str
    domains: list[str] = Field(min_length=1)


class DomainDeleteRequest(BaseModel):
    account_id: str
    domains: list[str] = Field(min_length=1)
