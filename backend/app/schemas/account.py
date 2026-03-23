from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


CredentialType = Literal["api_token", "global_key"]


class AccountCredentialApiToken(BaseModel):
    api_token: str = Field(min_length=10)


class AccountCredentialGlobalKey(BaseModel):
    email: str = Field(min_length=3)
    api_key: str = Field(min_length=10)


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    credential_type: CredentialType
    credentials: dict


class AccountPublic(BaseModel):
    id: str
    name: str
    credential_type: CredentialType
    created_at: datetime


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    credential_type: CredentialType | None = None
    credentials: dict | None = None

