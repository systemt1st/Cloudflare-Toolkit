from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SslBatchSettings(BaseModel):
    ssl_mode: Literal["off", "flexible", "full", "strict", "origin_pull"] | None = None
    always_use_https: bool | None = None
    min_tls_version: Literal["1.0", "1.1", "1.2", "1.3"] | None = None
    tls_1_3: bool | None = None
    automatic_https_rewrites: bool | None = None
    opportunistic_encryption: bool | None = None
    universal_ssl: bool | None = None


class SslBatchRequest(BaseModel):
    account_id: str
    domains: list[str] = Field(min_length=1)
    settings: SslBatchSettings
