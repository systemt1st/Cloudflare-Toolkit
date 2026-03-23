from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.exceptions import FatalTaskError, QuotaExceededError
from app.database import SessionLocal
from app.models.operation_log import OperationLog
from app.models.subscription import Subscription
from app.models.user import User

_OP_LOG_QUEUE: asyncio.Queue[dict] | None = None
_OP_LOG_WORKER: asyncio.Task | None = None
_OP_LOG_QUEUE_MAXSIZE = 5000
_OP_LOG_BATCH_SIZE = 200
_OP_LOG_FLUSH_INTERVAL_SECONDS = 0.2


def _month_start(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def sync_user_subscription(db: AsyncSession, user: User) -> bool:
    now = datetime.now(timezone.utc)

    expired_result = await db.execute(
        update(Subscription)
        .where(Subscription.user_id == user.id, Subscription.status == "active", Subscription.end_time.is_not(None))
        .where(Subscription.end_time <= now)
        .values(status="expired")
    )
    changed = bool(getattr(expired_result, "rowcount", 0))

    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user.id, Subscription.status == "active")
        .where((Subscription.end_time.is_(None)) | (Subscription.end_time > now))
        .order_by(Subscription.start_time.desc())
        .limit(1)
    )
    sub = result.scalar_one_or_none()
    desired = (sub.plan_type if sub else "free").strip() or "free"

    if user.subscription_status != desired:
        user.subscription_status = desired
        changed = True
    return changed


async def reset_monthly_credits_if_needed(db: AsyncSession, user: User) -> bool:
    if user.subscription_status != "free":
        return False

    now = datetime.now(timezone.utc)
    boundary = _month_start(now)
    if user.credits_reset_at and user.credits_reset_at >= boundary:
        return False

    user.credits = settings.FREE_MONTHLY_CREDITS
    user.credits_reset_at = now
    return True


async def ensure_quota_for_batch(user: User, *, items: int) -> None:
    if user.subscription_status != "free":
        return

    need = int(items) * int(settings.CREDITS_PER_ITEM)
    if user.credits < need:
        raise QuotaExceededError("积分不足，请升级订阅或等待下月重置")


async def consume_credits_for_item(user_id: str) -> None:
    user_uuid = uuid.UUID(user_id)
    cost = int(settings.CREDITS_PER_ITEM)

    async with SessionLocal() as db:
        updated = await db.execute(
            update(User)
            .where(User.id == user_uuid, User.subscription_status == "free", User.deleted_at.is_(None))
            .where(User.credits >= cost)
            .values(credits=User.credits - cost)
        )
        if bool(getattr(updated, "rowcount", 0)):
            await db.commit()
            return

        # 失败场景再查一次：用于区分“非免费用户/用户不存在”与“积分不足”
        result = await db.execute(select(User).where(User.id == user_uuid, User.deleted_at.is_(None)))
        user = result.scalar_one_or_none()
        if not user:
            return
        if user.subscription_status != "free":
            return
        if user.credits < cost:
            raise FatalTaskError("积分不足，请升级订阅或等待下月重置")

        # 并发下的边缘情况：可能刚好被其他请求扣减导致 update 不生效
        updated = await db.execute(
            update(User)
            .where(User.id == user_uuid, User.subscription_status == "free", User.deleted_at.is_(None))
            .where(User.credits >= cost)
            .values(credits=User.credits - cost)
        )
        if bool(getattr(updated, "rowcount", 0)):
            await db.commit()
            return
        raise FatalTaskError("积分不足，请升级订阅或等待下月重置")


async def write_operation_log(
    *,
    user_id: str,
    operation_type: str,
    target_domain: str | None,
    result: str,
    details: dict | None,
) -> None:
    user_uuid = uuid.UUID(user_id)
    async with SessionLocal() as db:
        db.add(
            OperationLog(
                user_id=user_uuid,
                operation_type=operation_type,
                target_domain=target_domain,
                result=result,
                details=details,
            )
        )
        await db.commit()


def _ensure_op_log_worker_started() -> None:
    global _OP_LOG_QUEUE, _OP_LOG_WORKER
    if _OP_LOG_QUEUE is None:
        _OP_LOG_QUEUE = asyncio.Queue(maxsize=_OP_LOG_QUEUE_MAXSIZE)
    if _OP_LOG_WORKER is None or _OP_LOG_WORKER.done():
        _OP_LOG_WORKER = asyncio.create_task(_op_log_worker())


async def _op_log_worker() -> None:
    assert _OP_LOG_QUEUE is not None
    loop = asyncio.get_running_loop()
    while True:
        first = await _OP_LOG_QUEUE.get()
        batch = [first]
        started_at = loop.time()
        while len(batch) < _OP_LOG_BATCH_SIZE:
            timeout = _OP_LOG_FLUSH_INTERVAL_SECONDS - (loop.time() - started_at)
            if timeout <= 0:
                break
            try:
                item = await asyncio.wait_for(_OP_LOG_QUEUE.get(), timeout=timeout)
            except asyncio.TimeoutError:
                break
            batch.append(item)

        try:
            async with SessionLocal() as db:
                db.add_all([OperationLog(**row) for row in batch])
                await db.commit()
        except Exception:  # noqa: BLE001
            pass
        finally:
            for _ in batch:
                _OP_LOG_QUEUE.task_done()


async def enqueue_operation_log(
    *,
    user_id: str,
    operation_type: str,
    target_domain: str | None,
    result: str,
    details: dict | None,
) -> None:
    try:
        _ensure_op_log_worker_started()
    except RuntimeError:
        await write_operation_log(
            user_id=user_id,
            operation_type=operation_type,
            target_domain=target_domain,
            result=result,
            details=details,
        )
        return

    assert _OP_LOG_QUEUE is not None
    try:
        _OP_LOG_QUEUE.put_nowait(
            {
                "user_id": uuid.UUID(user_id),
                "operation_type": operation_type,
                "target_domain": target_domain,
                "result": result,
                "details": details,
            }
        )
    except asyncio.QueueFull:
        return


def make_task_hooks(*, user_id: str, task_type: str, task_id: str):
    async def before_item(_item: dict) -> None:
        await consume_credits_for_item(user_id)

    async def after_item(item: dict, status: str, message: str, result_obj: dict | None, fatal: bool) -> None:
        domain = str(item.get("domain") or "").strip() or None
        await enqueue_operation_log(
            user_id=user_id,
            operation_type=task_type,
            target_domain=domain,
            result="success" if status == "success" else "failed",
            details={
                "task_id": task_id,
                "status": status,
                "message": message,
                "fatal": fatal,
                "item": item,
                "result": result_obj,
            },
        )

    return before_item, after_item
