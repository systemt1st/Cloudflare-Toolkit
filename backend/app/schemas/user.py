from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    nickname: str = Field(min_length=1, max_length=50)


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    nickname: str
    subscription_status: str
    credits: int
    created_at: datetime


class UserMe(BaseModel):
    id: str
    email: EmailStr
    nickname: str
    subscription_status: str
    credits: int


class UserUpdate(BaseModel):
    nickname: str | None = Field(default=None, min_length=1, max_length=50)


class UserPasswordUpdate(BaseModel):
    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
