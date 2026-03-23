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
from app.schemas.ssl import SslBatchRequest
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
async def batch_ssl(
    payload: SslBatchRequest,
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

    settings_obj = payload.settings
    if (
        settings_obj.ssl_mode is None
        and settings_obj.always_use_https is None
        and settings_obj.min_tls_version is None
        and settings_obj.tls_1_3 is None
        and settings_obj.automatic_https_rewrites is None
        and settings_obj.opportunistic_encryption is None
        and settings_obj.universal_ssl is None
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
        items.append(
            {
                "domain": d,
                "zone_id": zone_map.get(d, ""),
                "settings": settings_obj.model_dump(),
            }
        )

    await ensure_quota_for_batch(current_user, items=len(items))
    engine = TaskEngine(redis)
    changed_keys: list[str] = []
    if settings_obj.ssl_mode is not None:
        changed_keys.append("ssl_mode")
    if settings_obj.always_use_https is not None:
        changed_keys.append("always_use_https")
    if settings_obj.min_tls_version is not None:
        changed_keys.append("min_tls_version")
    if settings_obj.tls_1_3 is not None:
        changed_keys.append("tls_1_3")
    if settings_obj.automatic_https_rewrites is not None:
        changed_keys.append("automatic_https_rewrites")
    if settings_obj.opportunistic_encryption is not None:
        changed_keys.append("opportunistic_encryption")
    if settings_obj.universal_ssl is not None:
        changed_keys.append("universal_ssl")
    task_id = await engine.create_task(
        "ssl_batch",
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
        if raw.get("ssl_mode") is not None:
            updates.append(("ssl", raw["ssl_mode"]))
        if raw.get("always_use_https") is not None:
            updates.append(("always_use_https", _bool_to_on_off(bool(raw["always_use_https"]))))
        if raw.get("min_tls_version") is not None:
            updates.append(("min_tls_version", raw["min_tls_version"]))
        if raw.get("tls_1_3") is not None:
            updates.append(("tls_1_3", _bool_to_on_off(bool(raw["tls_1_3"]))))
        if raw.get("automatic_https_rewrites") is not None:
            updates.append(("automatic_https_rewrites", _bool_to_on_off(bool(raw["automatic_https_rewrites"]))))
        if raw.get("opportunistic_encryption") is not None:
            updates.append(("opportunistic_encryption", _bool_to_on_off(bool(raw["opportunistic_encryption"]))))
        if raw.get("universal_ssl") is not None:
            updates.append(("universal_ssl", _bool_to_on_off(bool(raw["universal_ssl"]))))

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

    before_item, after_item = make_task_hooks(user_id=str(current_user.id), task_type="ssl_batch", task_id=task_id)
    await engine.start_background_execution(task_id, executor, before_item=before_item, after_item=after_item)
    return TaskCreateResponse(task_id=task_id, total=len(items))
