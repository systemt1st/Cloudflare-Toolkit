from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.core.exceptions import ActivationCodeError, ForbiddenError, ValidationError
from app.database import get_db
from app.models.activation_code import ActivationCode
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.subscription import SubscriptionActivateRequest, SubscriptionMe, SubscriptionRedeemRequest

router = APIRouter()


def _normalize_activation_code(value: str) -> str:
    raw = str(value or "").strip()
    raw = raw.replace(" ", "").replace("-", "")
    return raw.upper()


async def _activate_subscription(db: AsyncSession, *, user_id: uuid.UUID, plan_type: str, days: int, payment_id: str) -> Subscription:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user_id, Subscription.status == "active")
        .where((Subscription.end_time.is_(None)) | (Subscription.end_time > now))
        .order_by(Subscription.end_time.desc().nullslast(), Subscription.start_time.desc())
        .limit(1)
    )
    active = result.scalar_one_or_none()
    base_end = active.end_time if active and active.end_time and active.end_time > now else now
    new_end = base_end + timedelta(days=int(days))

    await db.execute(
        update(Subscription)
        .where(Subscription.user_id == user_id, Subscription.status == "active")
        .values(status="cancelled")
    )

    sub = Subscription(
        user_id=user_id,
        plan_type=plan_type,
        start_time=now,
        end_time=new_end,
        status="active",
        payment_id=payment_id,
    )
    db.add(sub)
    await db.execute(update(User).where(User.id == user_id, User.deleted_at.is_(None)).values(subscription_status=plan_type))
    return sub


@router.get("/me", response_model=SubscriptionMe)
async def get_my_subscription(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionMe:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == current_user.id, Subscription.status == "active")
        .where((Subscription.end_time.is_(None)) | (Subscription.end_time > now))
        .order_by(Subscription.start_time.desc())
        .limit(1)
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return SubscriptionMe(plan_type="free", status="free")

    return SubscriptionMe(plan_type=sub.plan_type, status=sub.status, start_time=sub.start_time, end_time=sub.end_time)


@router.post("/dev/activate", response_model=SubscriptionMe)
async def dev_activate_subscription(
    payload: SubscriptionActivateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionMe:
    if settings.ENV != "dev":
        raise ForbiddenError("仅开发环境可用")

    now = datetime.now(timezone.utc)
    await db.execute(
        update(Subscription)
        .where(Subscription.user_id == current_user.id, Subscription.status == "active")
        .values(status="cancelled")
    )

    sub = Subscription(
        user_id=current_user.id,
        plan_type=payload.plan_type,
        start_time=now,
        end_time=now + timedelta(days=int(payload.days)),
        status="active",
        payment_id="dev",
    )
    db.add(sub)

    current_user.subscription_status = payload.plan_type
    await db.commit()
    await db.refresh(sub)
    return SubscriptionMe(plan_type=sub.plan_type, status=sub.status, start_time=sub.start_time, end_time=sub.end_time)


@router.post("/redeem", response_model=SubscriptionMe)
async def redeem_activation_code(
    payload: SubscriptionRedeemRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionMe:
    code = _normalize_activation_code(payload.code)
    if not code:
        raise ActivationCodeError("ACTIVATION_CODE_REQUIRED", "激活码不能为空")

    now = datetime.now(timezone.utc)
    sub: Subscription | None = None

    async with db.begin():
        result = await db.execute(select(ActivationCode).where(ActivationCode.code == code).with_for_update().limit(1))
        row = result.scalar_one_or_none()
        if not row:
            raise ActivationCodeError("ACTIVATION_CODE_INVALID", "激活码无效")
        if row.redeemed_at is not None:
            raise ActivationCodeError("ACTIVATION_CODE_USED", "激活码已使用")
        if row.expires_at and row.expires_at <= now:
            raise ActivationCodeError("ACTIVATION_CODE_EXPIRED", "激活码已过期")

        plan_type = str(row.plan_type or "").strip() or "yearly"
        days = int(row.days or 0)
        if plan_type != "yearly" or days <= 0 or days > 3660:
            raise ActivationCodeError("ACTIVATION_CODE_INVALID", "激活码无效")

        row.redeemed_at = now
        row.redeemed_by = current_user.id
        sub = await _activate_subscription(db, user_id=current_user.id, plan_type=plan_type, days=days, payment_id=f"code:{row.id}")

    assert sub is not None
    await db.refresh(sub)
    return SubscriptionMe(plan_type=sub.plan_type, status=sub.status, start_time=sub.start_time, end_time=sub.end_time)

