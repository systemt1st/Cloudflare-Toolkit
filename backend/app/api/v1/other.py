from __future__ import annotations

import httpx
import uuid
from typing import Any

from fastapi import APIRouter, Depends
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_http_client, get_redis
from app.core.encryption import get_credential_encryption
from app.core.exceptions import FatalTaskError, NotFoundError, ValidationError
from app.database import get_db
from app.models.account import CFAccount
from app.models.domain_cache import DomainCache
from app.models.user import User
from app.schemas.other import OtherBatchRequest
from app.schemas.task import TaskCreateResponse
from app.services.billing import ensure_quota_for_batch, make_task_hooks
from app.services.cloudflare.client import CloudflareAPIError, CloudflareClient
from app.services.task_engine import TaskEngine

router = APIRouter()


def _parse_uuid(value: str, field: str = "id") -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as e:
        raise ValidationError(f"{field} 格式错误") from e


def _normalize_domain(value: str) -> str:
    d = value.strip()
    d = d.removeprefix("https://").removeprefix("http://")
    d = d.split("/")[0]
    return d.strip().lower().rstrip(".")


async def _get_account_or_404(db: AsyncSession, user_id: uuid.UUID, account_id: uuid.UUID) -> CFAccount:
    result = await db.execute(
        select(CFAccount).where(
            CFAccount.id == account_id,
            CFAccount.user_id == user_id,
            CFAccount.deleted_at.is_(None),
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise NotFoundError("操作账户不存在")
    return account


async def _get_zone_map(db: AsyncSession, account_id: uuid.UUID, domains: set[str]) -> dict[str, str]:
    if not domains:
        return {}
    result = await db.execute(
        select(DomainCache).where(DomainCache.account_id == account_id, DomainCache.domain.in_(sorted(domains)))
    )
    rows = result.scalars().all()
    return {r.domain.lower(): r.zone_id for r in rows}


def _bool_to_on_off(value: bool) -> str:
    return "on" if value else "off"


@router.post("/batch", response_model=TaskCreateResponse, status_code=202)
async def batch_other(
    payload: OtherBatchRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> TaskCreateResponse:
    account_uuid = _parse_uuid(payload.account_id, "account_id")
    account = await _get_account_or_404(db, current_user.id, account_uuid)

    domains = [_normalize_domain(x) for x in payload.domains]
    domains = [d for d in domains if d]
    domains = list(dict.fromkeys(domains))
    if not domains:
        raise ValidationError("domains 不能为空")

    s = payload.settings
    if (
        s.crawler_hints is None
        and s.bot_fight_mode is None
        and s.ai_scrape_shield is None
        and s.crawler_protection is None
        and s.managed_robots_txt is None
        and s.http2_to_origin is None
        and s.url_normalization is None
        and s.web_analytics is None
        and s.http3 is None
        and s.websockets is None
        and s.browser_check is None
        and s.hotlink_protection is None
    ):
        raise ValidationError("settings 不能为空")

    credentials = get_credential_encryption().decrypt(account.encrypted_credentials)
    client = CloudflareClient(
        credential_type=account.credential_type,
        credentials=credentials,
        http_client=http,
        redis=redis,
    )

    zone_map = await _get_zone_map(db, account_uuid, set(domains))
    if len(zone_map) < len(domains):
        try:
            zones = await client.list_all_zones()
        except CloudflareAPIError as e:
            if e.status_code in {401, 403}:
                raise ValidationError("Cloudflare 凭据无效或无权限") from e
            raise ValidationError(str(e)) from e
        for z in zones:
            name = _normalize_domain(str(z.get("name", "")))
            zone_id = str(z.get("id", "")).strip()
            if name and zone_id:
                zone_map.setdefault(name, zone_id)

    items: list[dict[str, Any]] = []
    for d in domains:
        items.append({"domain": d, "zone_id": zone_map.get(d, ""), "settings": s.model_dump()})

    await ensure_quota_for_batch(current_user, items=len(items))
    engine = TaskEngine(redis)
    changed_keys: list[str] = []
    if s.crawler_hints is not None:
        changed_keys.append("crawler_hints")
    if s.bot_fight_mode is not None:
        changed_keys.append("bot_fight_mode")
    if s.ai_scrape_shield is not None:
        changed_keys.append("ai_scrape_shield")
    if s.crawler_protection is not None:
        changed_keys.append("crawler_protection")
    if s.managed_robots_txt is not None:
        changed_keys.append("managed_robots_txt")
    if s.http2_to_origin is not None:
        changed_keys.append("http2_to_origin")
    if s.url_normalization is not None:
        changed_keys.append("url_normalization")
    if s.web_analytics is not None:
        changed_keys.append("web_analytics")
    if s.http3 is not None:
        changed_keys.append("http3")
    if s.websockets is not None:
        changed_keys.append("websockets")
    if s.browser_check is not None:
        changed_keys.append("browser_check")
    if s.hotlink_protection is not None:
        changed_keys.append("hotlink_protection")
    task_id = await engine.create_task(
        "other_batch",
        items,
        metadata={"account_id": str(account_uuid), "mode": ",".join(changed_keys)},
        user_id=str(current_user.id),
    )

    async def executor(item: dict) -> dict:
        domain = item.get("domain") or ""
        zone_id = item.get("zone_id") or ""
        if not zone_id:
            raise Exception(f"未找到 Zone：{domain}（请先刷新域名缓存）")

        raw = item.get("settings") or {}
        updates: list[tuple[str, Any]] = []
        if raw.get("crawler_hints") is not None:
            updates.append(("crawler_hints", _bool_to_on_off(bool(raw["crawler_hints"]))))
        if raw.get("bot_fight_mode") is not None:
            updates.append(("bot_fight_mode", _bool_to_on_off(bool(raw["bot_fight_mode"]))))
        if raw.get("ai_scrape_shield") is not None:
            updates.append(("ai_scrape_shield", raw["ai_scrape_shield"]))
        if raw.get("crawler_protection") is not None:
            updates.append(("crawler_protection", _bool_to_on_off(bool(raw["crawler_protection"]))))
        if raw.get("managed_robots_txt") is not None:
            updates.append(("managed_robots_txt", _bool_to_on_off(bool(raw["managed_robots_txt"]))))
        if raw.get("http2_to_origin") is not None:
            updates.append(("http2_to_origin", _bool_to_on_off(bool(raw["http2_to_origin"]))))
        if raw.get("url_normalization") is not None:
            updates.append(("url_normalization", raw["url_normalization"]))
        if raw.get("web_analytics") is not None:
            updates.append(("web_analytics", _bool_to_on_off(bool(raw["web_analytics"]))))
        if raw.get("http3") is not None:
            updates.append(("http3", _bool_to_on_off(bool(raw["http3"]))))
        if raw.get("websockets") is not None:
            updates.append(("websockets", _bool_to_on_off(bool(raw["websockets"]))))
        if raw.get("browser_check") is not None:
            updates.append(("browser_check", _bool_to_on_off(bool(raw["browser_check"]))))
        if raw.get("hotlink_protection") is not None:
            updates.append(("hotlink_protection", _bool_to_on_off(bool(raw["hotlink_protection"]))))

        try:
            changed = 0
            for setting_key, value in updates:
                await client.update_zone_setting(zone_id, setting_key, value)
                changed += 1
            return {"message": f"已更新 {changed} 项设置"}
        except CloudflareAPIError as e:
            if e.status_code in {401, 403}:
                raise FatalTaskError(str(e)) from e
            raise

    before_item, after_item = make_task_hooks(user_id=str(current_user.id), task_type="other_batch", task_id=task_id)
    await engine.start_background_execution(task_id, executor, before_item=before_item, after_item=after_item)
    return TaskCreateResponse(task_id=task_id, total=len(items))
