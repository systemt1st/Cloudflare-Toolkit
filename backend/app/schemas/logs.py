from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class OperationLogItem(BaseModel):
    id: str
    operation_type: str
    target_domain: str | None = None
    result: str
    details: dict | None = None
    created_at: datetime


class OperationLogListResponse(BaseModel):
    items: list[OperationLogItem]
    total: int
    limit: int = Field(ge=1, le=200)
    offset: int = Field(ge=0)

