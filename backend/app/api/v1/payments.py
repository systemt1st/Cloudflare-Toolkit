from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import hmac

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_http_client
from app.config import settings
from app.core.exceptions import NotFoundError, ValidationError
from app.database import get_db
from app.models.payment_order import PaymentOrder
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.payment import (
    BEpusdtCheckoutRequest,
    PaymentCheckoutResponse,
    PaymentOrderPublic,
    StripeCheckoutRequest,
    StripeCheckoutResponse,
)
from app.services.bepusdt import ALLOWED_TRADE_TYPES, make_signature, normalize_base_url

router = APIRouter()
logger = logging.getLogger(__name__)


def _normalize_locale(value: str | None) -> str:
    locale = str(value or "zh").strip().lower() or "zh"
    if locale not in {"zh", "en"}:
        return "zh"
    return locale


def _ts_to_dt(value: object) -> datetime | None:
    try:
        ts = int(value)  # type: ignore[arg-type]
    except Exception:
        return None
    if ts <= 0:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc)


def _cents_to_amount(cents: int) -> Decimal:
    return (Decimal(int(cents)) / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _parse_amount_cents(value: object) -> int:
    if value is None:
        raise ValidationError("amount 缺失")
    if isinstance(value, Decimal):
        amount = value
    else:
        amount = Decimal(str(value).strip())
    cents = (amount * Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(cents)


def _build_notify_url(request: Request) -> str:
    configured = str(settings.BEPUSDT_NOTIFY_URL or "").strip()
    if configured:
        return configured
    base = str(request.base_url).rstrip("/")
    return f"{base}/api/v1/payments/bepusdt/notify"


async def _activate_yearly_subscription(db: AsyncSession, *, user_id: uuid.UUID, payment_id: str) -> None:
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
    new_end = base_end + timedelta(days=365)

    await db.execute(
        update(Subscription)
        .where(Subscription.user_id == user_id, Subscription.status == "active")
        .values(status="cancelled")
    )

    sub = Subscription(
        user_id=user_id,
        plan_type="yearly",
        start_time=now,
        end_time=new_end,
        status="active",
        payment_id=payment_id,
    )
    db.add(sub)
    await db.execute(update(User).where(User.id == user_id, User.deleted_at.is_(None)).values(subscription_status="yearly"))


async def _refresh_user_subscription_status(db: AsyncSession, *, user_id: uuid.UUID) -> None:
    now = datetime.now(timezone.utc)
    await db.execute(
        update(Subscription)
        .where(Subscription.user_id == user_id, Subscription.status == "active", Subscription.end_time.is_not(None))
        .where(Subscription.end_time <= now)
        .values(status="expired")
    )

    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user_id, Subscription.status == "active")
        .where((Subscription.end_time.is_(None)) | (Subscription.end_time > now))
        .order_by(Subscription.start_time.desc())
        .limit(1)
    )
    sub = result.scalar_one_or_none()
    desired = (sub.plan_type if sub else "free").strip() or "free"
    await db.execute(update(User).where(User.id == user_id, User.deleted_at.is_(None)).values(subscription_status=desired))


async def _upsert_stripe_yearly_subscription(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    stripe_subscription_id: str,
    period_start: datetime,
    period_end: datetime,
) -> None:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user_id, Subscription.payment_id == stripe_subscription_id)
        .with_for_update()
        .limit(1)
    )
    sub = result.scalar_one_or_none()

    if not sub:
        await db.execute(
            update(Subscription).where(Subscription.user_id == user_id, Subscription.status == "active").values(status="cancelled")
        )
        sub = Subscription(
            user_id=user_id,
            plan_type="yearly",
            start_time=period_start,
            end_time=period_end,
            status="active" if period_end > now else "expired",
            payment_id=stripe_subscription_id,
        )
        db.add(sub)
    else:
        sub.plan_type = "yearly"
        if sub.start_time > period_start:
            sub.start_time = period_start
        sub.end_time = period_end
        sub.status = "active" if period_end > now else "expired"

    await db.execute(
        update(User)
        .where(User.id == user_id, User.deleted_at.is_(None))
        .values(subscription_status="yearly" if period_end > now else "free")
    )


@router.post("/bepusdt/checkout", response_model=PaymentCheckoutResponse)
async def bepusdt_checkout(
    payload: BEpusdtCheckoutRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> PaymentCheckoutResponse:
    base_url = normalize_base_url(settings.BEPUSDT_BASE_URL)
    if not base_url:
        raise ValidationError("未配置 BEPUSDT_BASE_URL")

    auth_token = str(settings.BEPUSDT_AUTH_TOKEN or "").strip()
    if not auth_token:
        raise ValidationError("未配置 BEPUSDT_AUTH_TOKEN")

    trade_type = str(payload.trade_type or settings.BEPUSDT_DEFAULT_TRADE_TYPE or "").strip()
    if trade_type not in ALLOWED_TRADE_TYPES:
        raise ValidationError("trade_type 不支持")

    amount_cents = int(settings.BEPUSDT_PRICE_YEARLY_CNY_CENTS)
    amount = _cents_to_amount(amount_cents)
    locale = str(payload.locale or "zh").strip().lower() or "zh"
    if locale not in {"zh", "en"}:
        locale = "zh"

    order_id = f"po_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    order = PaymentOrder(
        user_id=current_user.id,
        provider="bepusdt",
        order_id=order_id,
        plan_type=payload.plan_type,
        amount_cents=amount_cents,
        amount_currency="cny",
        trade_type=trade_type,
        status="created",
        expires_at=now + timedelta(seconds=int(settings.BEPUSDT_ORDER_TIMEOUT_SECONDS)),
    )
    db.add(order)
    await db.commit()

    notify_url = _build_notify_url(request)
    redirect_base = str(settings.FRONTEND_BASE_URL or "").strip().rstrip("/")
    if not redirect_base:
        redirect_base = str(request.base_url).rstrip("/")
    redirect_url = f"{redirect_base}/{locale}/subscription?order_id={order_id}"

    api_payload: dict[str, object] = {
        "order_id": order_id,
        "amount": float(amount),
        "trade_type": trade_type,
        "notify_url": notify_url,
        "redirect_url": redirect_url,
        "timeout": int(settings.BEPUSDT_ORDER_TIMEOUT_SECONDS),
    }
    api_payload["signature"] = make_signature(api_payload, auth_token)

    try:
        res = await http.post(f"{base_url}/api/v1/order/create-transaction", json=api_payload)
    except httpx.HTTPError as e:
        order.status = "failed"
        await db.commit()
        raise ValidationError("支付网关连接失败") from e

    data = res.json() if res.headers.get("content-type", "").startswith("application/json") else {}
    if res.status_code != 200 or str(data.get("status_code")) != "200":
        order.status = "failed"
        await db.commit()
        raise ValidationError("支付网关下单失败")

    payload_data = data.get("data") or {}
    trade_id = str(payload_data.get("trade_id") or "").strip()
    payment_url = str(payload_data.get("payment_url") or "").strip()
    token = str(payload_data.get("token") or "").strip()
    actual_amount = str(payload_data.get("actual_amount") or "").strip()
    expiration_time = int(payload_data.get("expiration_time") or int(settings.BEPUSDT_ORDER_TIMEOUT_SECONDS))

    if not trade_id or not payment_url or not token or not actual_amount:
        order.status = "failed"
        await db.commit()
        raise ValidationError("支付网关返回数据不完整")

    order.trade_id = trade_id
    order.payment_url = payment_url
    order.token = token
    order.actual_amount = actual_amount
    order.status = "waiting"
    order.expires_at = datetime.now(timezone.utc) + timedelta(seconds=expiration_time)
    await db.commit()

    return PaymentCheckoutResponse(
        order_id=order_id,
        trade_id=trade_id,
        payment_url=payment_url,
        trade_type=trade_type,
        amount=float(amount),
        currency="cny",
        token=token,
        actual_amount=actual_amount,
        expires_at=order.expires_at or datetime.now(timezone.utc),
    )


@router.post("/stripe/checkout", response_model=StripeCheckoutResponse)
async def stripe_checkout(
    payload: StripeCheckoutRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StripeCheckoutResponse:
    secret_key = str(settings.STRIPE_SECRET_KEY or "").strip()
    if not secret_key:
        raise ValidationError("未配置 STRIPE_SECRET_KEY")

    price_id = str(settings.STRIPE_PRICE_ID_YEARLY or "").strip()
    if not price_id:
        raise ValidationError("未配置 STRIPE_PRICE_ID_YEARLY")

    locale = _normalize_locale(payload.locale)
    order_id = f"po_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)

    order = PaymentOrder(
        user_id=current_user.id,
        provider="stripe",
        order_id=order_id,
        plan_type=payload.plan_type,
        amount_cents=0,
        amount_currency="usd",
        trade_type="stripe.subscription",
        status="created",
        expires_at=None,
    )
    db.add(order)
    await db.commit()

    redirect_base = str(settings.FRONTEND_BASE_URL or "").strip().rstrip("/")
    if not redirect_base:
        redirect_base = str(request.base_url).rstrip("/")
    success_url = f"{redirect_base}/{locale}/subscription?order_id={order_id}"
    cancel_url = success_url

    try:
        import stripe  # type: ignore[import-not-found]

        stripe.api_key = secret_key

        price = await asyncio.to_thread(stripe.Price.retrieve, price_id)
        currency = str(getattr(price, "currency", "") or "").strip().lower()
        unit_amount = int(getattr(price, "unit_amount", 0) or 0)
        if currency != "usd":
            raise ValidationError("Stripe Price 需为 USD")
        if unit_amount <= 0:
            raise ValidationError("Stripe Price 金额无效")

        session = await asyncio.to_thread(
            stripe.checkout.Session.create,
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            customer_email=current_user.email,
            client_reference_id=order_id,
            metadata={"order_id": order_id, "user_id": str(current_user.id), "plan_type": payload.plan_type},
            subscription_data={"metadata": {"order_id": order_id, "user_id": str(current_user.id), "plan_type": payload.plan_type}},
            allow_promotion_codes=bool(settings.STRIPE_ALLOW_PROMO_CODES),
            idempotency_key=order_id,
        )
    except ValidationError:
        order.status = "failed"
        await db.commit()
        raise
    except Exception as e:  # noqa: BLE001
        logger.exception("Stripe 下单失败")
        order.status = "failed"
        await db.commit()
        raise ValidationError("Stripe 下单失败") from e

    checkout_url = str(getattr(session, "url", "") or "").strip()
    session_id = str(getattr(session, "id", "") or "").strip()
    expires_at = _ts_to_dt(getattr(session, "expires_at", None))
    if not checkout_url or not session_id:
        order.status = "failed"
        await db.commit()
        raise ValidationError("Stripe 返回数据不完整")

    order.trade_id = session_id
    order.payment_url = checkout_url
    order.status = "waiting"
    order.expires_at = expires_at
    order.token = currency.upper()
    order.amount_currency = currency
    order.amount_cents = unit_amount
    order.actual_amount = f"{_cents_to_amount(unit_amount)}"
    await db.commit()

    return StripeCheckoutResponse(order_id=order_id, session_id=session_id, checkout_url=checkout_url, expires_at=expires_at)


@router.get("/orders/{order_id}", response_model=PaymentOrderPublic)
async def get_payment_order(
    order_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PaymentOrderPublic:
    oid = str(order_id or "").strip()
    if not oid:
        raise ValidationError("order_id 缺失")

    result = await db.execute(select(PaymentOrder).where(PaymentOrder.order_id == oid, PaymentOrder.user_id == current_user.id))
    order = result.scalar_one_or_none()
    if not order:
        raise NotFoundError("订单不存在")

    amount = _cents_to_amount(order.amount_cents)
    return PaymentOrderPublic(
        order_id=order.order_id,
        provider=order.provider,
        plan_type=order.plan_type,
        amount=float(amount),
        currency=order.amount_currency,
        trade_type=order.trade_type,
        status=order.status,
        trade_id=order.trade_id,
        payment_url=order.payment_url,
        token=order.token,
        actual_amount=order.actual_amount,
        expires_at=order.expires_at,
        paid_at=order.paid_at,
    )


@router.post("/bepusdt/notify")
async def bepusdt_notify(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> PlainTextResponse:
    auth_token = str(settings.BEPUSDT_AUTH_TOKEN or "").strip()
    if not auth_token:
        return PlainTextResponse("not_configured", status_code=500)

    raw = await request.body()
    try:
        payload = json.loads(raw or b"{}", parse_float=Decimal)
        payload_store = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        return PlainTextResponse("invalid_json", status_code=400)

    if not isinstance(payload, dict):
        return PlainTextResponse("invalid_payload", status_code=400)

    signature = str(payload.get("signature") or "").strip()
    if not signature:
        return PlainTextResponse("missing_signature", status_code=400)

    expected = make_signature(payload, auth_token)
    if not hmac.compare_digest(signature, expected):
        return PlainTextResponse("bad_signature", status_code=400)

    order_id = str(payload.get("order_id") or "").strip()
    trade_id = str(payload.get("trade_id") or "").strip()
    token = str(payload.get("token") or "").strip() or None
    actual_amount = payload.get("actual_amount")
    block_tx = str(payload.get("block_transaction_id") or "").strip() or None

    try:
        status = int(payload.get("status") or 0)
    except Exception:
        return PlainTextResponse("bad_status", status_code=400)

    if not order_id:
        return PlainTextResponse("missing_order_id", status_code=400)

    now = datetime.now(timezone.utc)
    async with db.begin():
        result = await db.execute(select(PaymentOrder).where(PaymentOrder.order_id == order_id).with_for_update())
        order = result.scalar_one_or_none()

        if not order:
            if status == 2:
                return PlainTextResponse("order_not_found", status_code=404)
            return PlainTextResponse("ok", status_code=200)

        order.raw_notify = payload_store if isinstance(payload_store, dict) else {"raw": str(payload_store)}
        if trade_id:
            order.trade_id = trade_id
        if token:
            order.token = token
        if actual_amount is not None:
            order.actual_amount = str(actual_amount)
        if block_tx:
            order.block_transaction_id = block_tx

        if status == 1:
            if order.status != "paid":
                order.status = "waiting"
            return PlainTextResponse("ok", status_code=200)

        if status == 3:
            if order.status != "paid":
                order.status = "expired"
            return PlainTextResponse("ok", status_code=200)

        if status != 2:
            return PlainTextResponse("unsupported_status", status_code=400)

        try:
            callback_cents = _parse_amount_cents(payload.get("amount"))
        except ValidationError:
            return PlainTextResponse("bad_amount", status_code=400)
        if int(callback_cents) != int(order.amount_cents):
            return PlainTextResponse("amount_mismatch", status_code=400)

        if order.status == "paid":
            return PlainTextResponse("ok", status_code=200)

        order.status = "paid"
        order.paid_at = now
        await _activate_yearly_subscription(db, user_id=order.user_id, payment_id=trade_id or order.order_id)
        return PlainTextResponse("ok", status_code=200)


def _stripe_price_matches_yearly(line: dict) -> bool:
    price = line.get("price") or {}
    pid = str(price.get("id") or "").strip()
    return bool(pid) and pid == str(settings.STRIPE_PRICE_ID_YEARLY or "").strip()


@router.post("/stripe/webhook")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> PlainTextResponse:
    webhook_secret = str(settings.STRIPE_WEBHOOK_SECRET or "").strip()
    secret_key = str(settings.STRIPE_SECRET_KEY or "").strip()
    price_id = str(settings.STRIPE_PRICE_ID_YEARLY or "").strip()
    if not webhook_secret or not secret_key or not price_id:
        logger.error("Stripe webhook 未配置（缺少 STRIPE_WEBHOOK_SECRET/STRIPE_SECRET_KEY/STRIPE_PRICE_ID_YEARLY）")
        return PlainTextResponse("not_configured", status_code=200)

    signature = str(request.headers.get("stripe-signature") or "").strip()
    if not signature:
        return PlainTextResponse("missing_signature", status_code=400)

    raw = await request.body()
    try:
        import stripe  # type: ignore[import-not-found]

        stripe.api_key = secret_key
        event = stripe.Webhook.construct_event(payload=raw, sig_header=signature, secret=webhook_secret)
    except Exception as e:  # noqa: BLE001
        name = getattr(getattr(e, "__class__", None), "__name__", "")
        if name == "SignatureVerificationError":
            return PlainTextResponse("bad_signature", status_code=400)
        logger.exception("Stripe webhook 验签/解析失败")
        return PlainTextResponse("invalid_payload", status_code=200)

    event_dict = event.to_dict_recursive() if hasattr(event, "to_dict_recursive") else event  # type: ignore[truthy-function]
    event_type = str((event_dict or {}).get("type") or "").strip()
    payload_obj = ((event_dict or {}).get("data") or {}).get("object") or {}
    if not isinstance(payload_obj, dict):
        return PlainTextResponse("ok", status_code=200)

    now = datetime.now(timezone.utc)

    try:
        if event_type == "checkout.session.completed":
            if str(payload_obj.get("mode") or "").strip() != "subscription":
                return PlainTextResponse("ok", status_code=200)

            order_id = str(payload_obj.get("client_reference_id") or "").strip()
            if not order_id:
                meta = payload_obj.get("metadata") or {}
                if isinstance(meta, dict):
                    order_id = str(meta.get("order_id") or "").strip()

            subscription_id = str(payload_obj.get("subscription") or "").strip()
            session_id = str(payload_obj.get("id") or "").strip()
            payment_status = str(payload_obj.get("payment_status") or "").strip().lower()

            if not order_id or not subscription_id or not session_id:
                return PlainTextResponse("ok", status_code=200)

            import stripe  # type: ignore[import-not-found]

            stripe.api_key = secret_key
            stripe_sub = await asyncio.to_thread(stripe.Subscription.retrieve, subscription_id, expand=["items.data.price"])
            stripe_sub_dict = stripe_sub.to_dict_recursive() if hasattr(stripe_sub, "to_dict_recursive") else stripe_sub
            items = ((stripe_sub_dict or {}).get("items") or {}).get("data") or []
            if not isinstance(items, list) or not any(_stripe_price_matches_yearly(item) for item in items if isinstance(item, dict)):
                return PlainTextResponse("ok", status_code=200)

            period_start = _ts_to_dt((stripe_sub_dict or {}).get("current_period_start")) or now
            period_end = _ts_to_dt((stripe_sub_dict or {}).get("current_period_end"))
            if not period_end:
                return PlainTextResponse("ok", status_code=200)

            async with db.begin():
                result = await db.execute(select(PaymentOrder).where(PaymentOrder.order_id == order_id).with_for_update())
                order = result.scalar_one_or_none()
                if not order or order.provider != "stripe":
                    return PlainTextResponse("ok", status_code=200)

                order.raw_notify = event_dict if isinstance(event_dict, dict) else {"raw": str(event_dict)}
                order.trade_id = session_id
                order.block_transaction_id = subscription_id

                if payment_status in {"paid", "no_payment_required"}:
                    if order.status != "paid":
                        order.status = "paid"
                        order.paid_at = now
                    await _upsert_stripe_yearly_subscription(
                        db,
                        user_id=order.user_id,
                        stripe_subscription_id=subscription_id,
                        period_start=period_start,
                        period_end=period_end,
                    )
                else:
                    if order.status not in {"paid"}:
                        order.status = "waiting"

            return PlainTextResponse("ok", status_code=200)

        if event_type == "invoice.paid":
            subscription_id = str(payload_obj.get("subscription") or "").strip()
            if not subscription_id:
                return PlainTextResponse("ok", status_code=200)

            lines = ((payload_obj.get("lines") or {}).get("data")) or []
            if not isinstance(lines, list):
                return PlainTextResponse("ok", status_code=200)
            matched = [line for line in lines if isinstance(line, dict) and _stripe_price_matches_yearly(line)]
            if not matched:
                return PlainTextResponse("ok", status_code=200)

            period_start_ts = min(int((line.get("period") or {}).get("start") or 0) for line in matched)
            period_end_ts = max(int((line.get("period") or {}).get("end") or 0) for line in matched)
            period_start = _ts_to_dt(period_start_ts) or now
            period_end = _ts_to_dt(period_end_ts)
            if not period_end:
                return PlainTextResponse("ok", status_code=200)

            async with db.begin():
                result = await db.execute(select(Subscription).where(Subscription.payment_id == subscription_id).with_for_update().limit(1))
                sub = result.scalar_one_or_none()
                if sub:
                    sub.plan_type = "yearly"
                    if sub.end_time is None or sub.end_time < period_end:
                        sub.end_time = period_end
                    if sub.status != "active":
                        sub.status = "active"
                    await db.execute(update(User).where(User.id == sub.user_id, User.deleted_at.is_(None)).values(subscription_status="yearly"))
                    return PlainTextResponse("ok", status_code=200)

            import stripe  # type: ignore[import-not-found]

            stripe.api_key = secret_key
            stripe_sub = await asyncio.to_thread(stripe.Subscription.retrieve, subscription_id, expand=["items.data.price"])
            stripe_sub_dict = stripe_sub.to_dict_recursive() if hasattr(stripe_sub, "to_dict_recursive") else stripe_sub
            items = ((stripe_sub_dict or {}).get("items") or {}).get("data") or []
            if not isinstance(items, list) or not any(_stripe_price_matches_yearly(item) for item in items if isinstance(item, dict)):
                return PlainTextResponse("ok", status_code=200)

            meta = (stripe_sub_dict or {}).get("metadata") or {}
            if not isinstance(meta, dict):
                return PlainTextResponse("ok", status_code=200)

            user_id = str(meta.get("user_id") or "").strip()
            order_id = str(meta.get("order_id") or "").strip()
            try:
                user_uuid = uuid.UUID(user_id)
            except ValueError:
                return PlainTextResponse("ok", status_code=200)

            sub_period_start = _ts_to_dt((stripe_sub_dict or {}).get("current_period_start")) or period_start
            sub_period_end = _ts_to_dt((stripe_sub_dict or {}).get("current_period_end")) or period_end

            async with db.begin():
                await _upsert_stripe_yearly_subscription(
                    db,
                    user_id=user_uuid,
                    stripe_subscription_id=subscription_id,
                    period_start=sub_period_start,
                    period_end=sub_period_end,
                )
                if order_id:
                    result = await db.execute(select(PaymentOrder).where(PaymentOrder.order_id == order_id).with_for_update().limit(1))
                    order = result.scalar_one_or_none()
                    if order and order.provider == "stripe":
                        order.raw_notify = event_dict if isinstance(event_dict, dict) else {"raw": str(event_dict)}
                        order.block_transaction_id = subscription_id
                        if order.status != "paid":
                            order.status = "paid"
                            order.paid_at = now

            return PlainTextResponse("ok", status_code=200)

        if event_type in {"customer.subscription.updated", "customer.subscription.deleted"}:
            subscription_id = str(payload_obj.get("id") or "").strip()
            if not subscription_id:
                return PlainTextResponse("ok", status_code=200)

            period_start = _ts_to_dt(payload_obj.get("current_period_start")) or now
            period_end = _ts_to_dt(payload_obj.get("current_period_end"))
            status = str(payload_obj.get("status") or "").strip().lower()

            async with db.begin():
                result = await db.execute(select(Subscription).where(Subscription.payment_id == subscription_id).with_for_update().limit(1))
                sub = result.scalar_one_or_none()
                if not sub:
                    return PlainTextResponse("ok", status_code=200)

                if period_end and (sub.end_time is None or sub.end_time < period_end):
                    sub.end_time = period_end
                if sub.start_time > period_start:
                    sub.start_time = period_start

                if event_type == "customer.subscription.deleted" or status in {"canceled", "unpaid", "incomplete_expired"}:
                    sub.status = "expired" if sub.end_time and sub.end_time <= now else "cancelled"
                else:
                    sub.status = "active" if sub.end_time and sub.end_time > now else sub.status
                await _refresh_user_subscription_status(db, user_id=sub.user_id)

            return PlainTextResponse("ok", status_code=200)
    except Exception:  # noqa: BLE001
        logger.exception("Stripe webhook 处理异常")
        return PlainTextResponse("error", status_code=500)

    return PlainTextResponse("ok", status_code=200)
