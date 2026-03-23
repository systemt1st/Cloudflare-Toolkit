from __future__ import annotations

import re

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.exceptions import ValidationError
from app.core.security import hash_password, verify_password
from app.database import get_db
from app.models.user import User
from app.schemas.user import UserMe, UserPasswordUpdate, UserUpdate

router = APIRouter()


@router.get("/me", response_model=UserMe)
async def me(current_user: User = Depends(get_current_user)) -> UserMe:
    return UserMe(
        id=str(current_user.id),
        email=current_user.email,
        nickname=current_user.nickname,
        subscription_status=current_user.subscription_status,
        credits=current_user.credits,
    )


@router.patch("/me", response_model=UserMe)
async def update_me(
    payload: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserMe:
    if payload.nickname is None:
        raise ValidationError("nickname 不能为空")

    nickname = payload.nickname.strip()
    if not nickname:
        raise ValidationError("nickname 不能为空")
    if re.search(r"[A-Z]", nickname):
        raise ValidationError("昵称不允许包含大写字母")

    current_user.nickname = nickname
    await db.commit()
    await db.refresh(current_user)

    return UserMe(
        id=str(current_user.id),
        email=current_user.email,
        nickname=current_user.nickname,
        subscription_status=current_user.subscription_status,
        credits=current_user.credits,
    )


@router.put("/me/password")
async def update_password(
    payload: UserPasswordUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not current_user.password_hash:
        raise ValidationError("当前账户未设置密码，请使用找回密码设置")

    if not verify_password(payload.old_password, current_user.password_hash):
        raise ValidationError("原密码错误")

    if payload.old_password == payload.new_password:
        raise ValidationError("新密码不能与原密码相同")

    current_user.password_hash = hash_password(payload.new_password)
    await db.commit()
    return {"message": "ok"}
