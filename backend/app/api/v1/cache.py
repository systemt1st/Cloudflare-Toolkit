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
from app.schemas.cache import CacheBatchRequest, CachePurgeRequest
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
async def batch_cache_settings(
    payload: CacheBatchRequest,
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
        settings_obj.cache_level is None
        and settings_obj.browser_cache_ttl is None
        and settings_obj.tiered_cache is None
        and settings_obj.always_online is None
        and settings_obj.development_mode is None
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
        items.append({"domain": d, "zone_id": zone_map.get(d, ""), "settings": settings_obj.model_dump()})

    await ensure_quota_for_batch(current_user, items=len(items))
    engine = TaskEngine(redis)
    changed_keys: list[str] = []
    if settings_obj.cache_level is not None:
        changed_keys.append("cache_level")
    if settings_obj.browser_cache_ttl is not None:
        changed_keys.append("browser_cache_ttl")
    if settings_obj.tiered_cache is not None:
        changed_keys.append("tiered_cache")
    if settings_obj.always_online is not None:
        changed_keys.append("always_online")
    if settings_obj.development_mode is not None:
        changed_keys.append("development_mode")
    task_id = await engine.create_task(
        "cache_batch",
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
        if raw.get("cache_level") is not None:
            updates.append(("cache_level", raw["cache_level"]))
        if raw.get("browser_cache_ttl") is not None:
            updates.append(("browser_cache_ttl", int(raw["browser_cache_ttl"])))
        if raw.get("tiered_cache") is not None:
            updates.append(("tiered_cache", _bool_to_on_off(bool(raw["tiered_cache"]))))
        if raw.get("always_online") is not None:
            updates.append(("always_online", _bool_to_on_off(bool(raw["always_online"]))))
        if raw.get("development_mode") is not None:
            updates.append(("development_mode", _bool_to_on_off(bool(raw["development_mode"]))))

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

    before_item, after_item = make_task_hooks(user_id=str(current_user.id), task_type="cache_batch", task_id=task_id)
    await engine.start_background_execution(task_id, executor, before_item=before_item, after_item=after_item)
    return TaskCreateResponse(task_id=task_id, total=len(items))


@router.post("/purge", response_model=TaskCreateResponse, status_code=202)
async def purge_cache(
    payload: CachePurgeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> TaskCreateResponse:
    if not payload.confirm:
        raise ValidationError("purge 需要 confirm=true")

    account_uuid = _parse_uuid(payload.account_id, "account_id")
    account = await _get_account_or_404(db, current_user.id, account_uuid)

    domains = [_normalize_domain(x) for x in payload.domains]
    domains = [d for d in domains if d]
    domains = list(dict.fromkeys(domains))
    if not domains:
        raise ValidationError("domains 不能为空")

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

    files: list[str] = []
    if payload.files:
        files = [str(x).strip() for x in payload.files if str(x).strip()]
        files = list(dict.fromkeys(files))
        if not files:
            files = []

    items: list[dict[str, Any]] = []
    for d in domains:
        item: dict[str, Any] = {"domain": d, "zone_id": zone_map.get(d, "")}
        if files:
            item["files"] = files
        items.append(item)

    await ensure_quota_for_batch(current_user, items=len(items))
    engine = TaskEngine(redis)
    mode = "files" if files else "everything"
    task_id = await engine.create_task(
        "cache_purge",
        items,
        metadata={"account_id": str(account_uuid), "mode": mode},
        user_id=str(current_user.id),
    )

    def _normalize_purge_files(domain: str, raw_files: list[str]) -> list[str]:
        out: list[str] = []
        for raw in raw_files:
            f = raw.strip()
            if not f:
                continue
            if f.startswith("http://") or f.startswith("https://"):
                out.append(f)
                continue
            if f.startswith("//"):
                out.append(f"https:{f}")
                continue
            if f.startswith("/"):
                out.append(f"https://{domain}{f}")
                continue
            out.append(f"https://{domain}/{f}")
        return out

    async def executor(item: dict) -> dict:
        domain = item.get("domain") or ""
        zone_id = item.get("zone_id") or ""
        if not zone_id:
            raise Exception(f"未找到 Zone：{domain}（请先刷新域名缓存）")

        try:
            raw_files = item.get("files") or []
            if raw_files:
                normalized = _normalize_purge_files(domain, raw_files)
                chunks = [normalized[i : i + 30] for i in range(0, len(normalized), 30)]
                for chunk in chunks:
                    await client.purge_cache(zone_id, purge_everything=False, files=chunk)
                return {"message": f"已清除 {len(normalized)} 条 URL 缓存（分 {len(chunks)} 次）"}
            await client.purge_cache(zone_id, purge_everything=True)
            return {"message": "清除成功"}
        except CloudflareAPIError as e:
            if e.status_code in {401, 403}:
                raise FatalTaskError(str(e)) from e
            raise

    before_item, after_item = make_task_hooks(user_id=str(current_user.id), task_type="cache_purge", task_id=task_id)
    await engine.start_background_execution(task_id, executor, before_item=before_item, after_item=after_item)
    return TaskCreateResponse(task_id=task_id, total=len(items))
