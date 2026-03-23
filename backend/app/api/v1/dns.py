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
from app.schemas.dns import DnsDeleteRequest, DnsProxyRequest, DnsReplaceRequest, DnsResolveRequest
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


def _build_record_fqdn(record_name: str, domain: str) -> str:
    name = record_name.strip().rstrip(".")
    if not name or name == "@":
        return domain
    if name == domain or name.endswith(f".{domain}"):
        return name
    return f"{name}.{domain}"


def _is_duplicate_record_error(exc: CloudflareAPIError) -> bool:
    for err in exc.errors:
        code = err.get("code")
        message = str(err.get("message", "")).lower()
        if code in {81057, 81058}:
            return True
        if "already exists" in message or "identical record" in message:
            return True
    return False


async def _list_all_dns_records(client: CloudflareClient, zone_id: str, **params: Any) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    page = 1
    per_page = int(params.pop("per_page", 100) or 100)
    while True:
        data = await client.list_dns_records(zone_id, page=page, per_page=per_page, **params)
        result = data.get("result", []) or []
        records.extend(result)

        info = data.get("result_info") or {}
        total_pages = info.get("total_pages")
        if total_pages:
            if page >= int(total_pages):
                break
        else:
            if len(result) < per_page:
                break
        page += 1
    return records


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


async def _get_zone_map(
    db: AsyncSession,
    account_id: uuid.UUID,
    domains: set[str],
) -> dict[str, str]:
    if not domains:
        return {}
    result = await db.execute(
        select(DomainCache).where(DomainCache.account_id == account_id, DomainCache.domain.in_(sorted(domains)))
    )
    rows = result.scalars().all()
    return {r.domain.lower(): r.zone_id for r in rows}


@router.post("/resolve", response_model=TaskCreateResponse, status_code=202)
async def resolve_dns(
    payload: DnsResolveRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> TaskCreateResponse:
    account_uuid = _parse_uuid(payload.account_id, "account_id")
    account = await _get_account_or_404(db, current_user.id, account_uuid)

    credentials = get_credential_encryption().decrypt(account.encrypted_credentials)
    client = CloudflareClient(
        credential_type=account.credential_type,
        credentials=credentials,
        http_client=http,
        redis=redis,
    )

    ops: list[dict[str, Any]] = []
    if payload.mode == "same_value":
        for raw_domain in payload.domains:
            domain = _normalize_domain(raw_domain)
            if not domain:
                continue
            ops.append(
                {
                    "domain": domain,
                    "record": {
                        "type": payload.record_type.upper(),
                        "name": _build_record_fqdn(payload.record_name, domain),
                        "content": payload.record_value,
                        "ttl": payload.ttl,
                        "proxied": payload.proxied,
                    },
                }
            )
    elif payload.mode == "different_value":
        for row in payload.records:
            domain = _normalize_domain(row.domain)
            if not domain:
                continue
            ops.append(
                {
                    "domain": domain,
                    "record": {
                        "type": payload.record_type.upper(),
                        "name": _build_record_fqdn(payload.record_name, domain),
                        "content": row.value,
                        "ttl": payload.ttl,
                        "proxied": payload.proxied,
                    },
                }
            )
    elif payload.mode == "site_group":
        values = [v.strip() for v in payload.values if v.strip()]
        if not values:
            raise ValidationError("values 不能为空")
        for idx, raw_domain in enumerate(payload.domains):
            domain = _normalize_domain(raw_domain)
            if not domain:
                continue
            ops.append(
                {
                    "domain": domain,
                    "record": {
                        "type": payload.record_type.upper(),
                        "name": _build_record_fqdn(payload.record_name, domain),
                        "content": values[idx % len(values)],
                        "ttl": payload.ttl,
                        "proxied": payload.proxied,
                    },
                }
            )
    elif payload.mode == "custom":
        for row in payload.records:
            domain = _normalize_domain(row.domain)
            if not domain:
                continue
            record_type = row.type.strip().upper()
            ops.append(
                {
                    "domain": domain,
                    "record": {
                        "type": record_type,
                        "name": _build_record_fqdn(row.name, domain),
                        "content": row.value,
                        "ttl": row.ttl,
                        "proxied": bool(row.proxied) if row.proxied is not None else False,
                    },
                }
            )

    if not ops:
        raise ValidationError("没有有效的域名记录可执行")

    domains = {op["domain"] for op in ops if op.get("domain")}
    zone_map = await _get_zone_map(db, account_uuid, domains)

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
    for op in ops:
        domain = op["domain"]
        items.append({"domain": domain, "zone_id": zone_map.get(domain, ""), "record": op["record"]})

    await ensure_quota_for_batch(current_user, items=len(items))
    engine = TaskEngine(redis)
    task_id = await engine.create_task(
        "dns_resolve",
        items,
        metadata={"account_id": str(account_uuid), "mode": payload.mode},
        user_id=str(current_user.id),
    )

    async def executor(item: dict) -> dict:
        domain = item.get("domain") or ""
        zone_id = item.get("zone_id") or ""
        record = item.get("record") or {}
        if not zone_id:
            raise Exception(f"未找到 Zone：{domain}（请先刷新域名缓存）")

        try:
            await client.create_dns_record(zone_id, record)
            return {"message": "创建成功"}
        except CloudflareAPIError as e:
            if e.status_code in {401, 403}:
                raise FatalTaskError(str(e)) from e
            if _is_duplicate_record_error(e):
                try:
                    existed = await _list_all_dns_records(
                        client,
                        zone_id,
                        type=record.get("type"),
                        name=record.get("name"),
                    )
                    want_content = str(record.get("content") or "")
                    if any(str(r.get("content") or "") == want_content for r in existed):
                        return {"message": "已存在"}
                    if len(existed) == 1:
                        record_id = str(existed[0].get("id", "")).strip()
                        if record_id:
                            await client.update_dns_record(zone_id, record_id, record)
                            return {"message": "已更新"}
                    if len(existed) > 1:
                        return {"message": f"存在 {len(existed)} 条同名记录，已跳过更新"}
                except CloudflareAPIError:
                    pass
                return {"message": "记录已存在"}
            raise

    before_item, after_item = make_task_hooks(user_id=str(current_user.id), task_type="dns_resolve", task_id=task_id)
    await engine.start_background_execution(task_id, executor, before_item=before_item, after_item=after_item)
    return TaskCreateResponse(task_id=task_id, total=len(items))


@router.post("/replace", response_model=TaskCreateResponse, status_code=202)
async def replace_dns(
    payload: DnsReplaceRequest,
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

    credentials = get_credential_encryption().decrypt(account.encrypted_credentials)
    client = CloudflareClient(
        credential_type=account.credential_type,
        credentials=credentials,
        http_client=http,
        redis=redis,
    )

    domain_set = set(domains)
    zone_map = await _get_zone_map(db, account_uuid, domain_set)
    if len(zone_map) < len(domain_set):
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

    record_type = payload.record_type.strip().upper()
    if not record_type:
        raise ValidationError("record_type 不能为空")

    items: list[dict[str, Any]] = []
    for d in domains:
        items.append(
            {
                "domain": d,
                "zone_id": zone_map.get(d, ""),
                "record_type": record_type,
                "record_name": _build_record_fqdn(payload.record_name, d),
                "old_value": payload.old_value,
                "new_value": payload.new_value,
            }
        )

    await ensure_quota_for_batch(current_user, items=len(items))
    engine = TaskEngine(redis)
    task_id = await engine.create_task(
        "dns_replace",
        items,
        metadata={"account_id": str(account_uuid), "mode": f"{record_type} {payload.record_name.strip()}"},
        user_id=str(current_user.id),
    )

    async def executor(item: dict) -> dict:
        domain = item.get("domain") or ""
        zone_id = item.get("zone_id") or ""
        if not zone_id:
            raise Exception(f"未找到 Zone：{domain}（请先刷新域名缓存）")

        try:
            records = await _list_all_dns_records(
                client,
                zone_id,
                type=item.get("record_type"),
                name=item.get("record_name"),
            )
            matched = [r for r in records if str(r.get("content") or "") == str(item.get("old_value") or "")]
            if not matched:
                return {"message": "未找到可替换记录"}

            replaced = 0
            for r in matched:
                record_id = str(r.get("id") or "").strip()
                if not record_id:
                    continue
                update_payload: dict[str, Any] = {
                    "type": r.get("type") or item.get("record_type"),
                    "name": r.get("name") or item.get("record_name"),
                    "content": item.get("new_value"),
                    "ttl": r.get("ttl", 1),
                }
                if r.get("proxied") is not None:
                    update_payload["proxied"] = r.get("proxied")
                await client.update_dns_record(zone_id, record_id, update_payload)
                replaced += 1

            return {"message": f"已替换 {replaced} 条"}
        except CloudflareAPIError as e:
            if e.status_code in {401, 403}:
                raise FatalTaskError(str(e)) from e
            raise

    before_item, after_item = make_task_hooks(user_id=str(current_user.id), task_type="dns_replace", task_id=task_id)
    await engine.start_background_execution(task_id, executor, before_item=before_item, after_item=after_item)
    return TaskCreateResponse(task_id=task_id, total=len(items))


@router.post("/delete", response_model=TaskCreateResponse, status_code=202)
async def delete_dns(
    payload: DnsDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> TaskCreateResponse:
    account_uuid = _parse_uuid(payload.account_id, "account_id")
    account = await _get_account_or_404(db, current_user.id, account_uuid)

    credentials = get_credential_encryption().decrypt(account.encrypted_credentials)
    client = CloudflareClient(
        credential_type=account.credential_type,
        credentials=credentials,
        http_client=http,
        redis=redis,
    )

    items: list[dict[str, Any]] = []
    target_domains: set[str] = set()

    if payload.mode == "by_record":
        domains = [_normalize_domain(x) for x in payload.domains]
        domains = [d for d in domains if d]
        domains = list(dict.fromkeys(domains))
        if not domains:
            raise ValidationError("domains 不能为空")

        record_type = payload.record_type.strip().upper()
        if not record_type:
            raise ValidationError("record_type 不能为空")

        for d in domains:
            target_domains.add(d)
            items.append(
                {
                    "domain": d,
                    "zone_id": "",
                    "mode": "by_record",
                    "record_type": record_type,
                    "record_name": _build_record_fqdn(payload.record_name, d),
                    "record_value": payload.record_value,
                }
            )
    elif payload.mode == "clear":
        if not payload.confirm:
            raise ValidationError("clear 模式需要 confirm=true")
        domains = [_normalize_domain(x) for x in payload.domains]
        domains = [d for d in domains if d]
        domains = list(dict.fromkeys(domains))
        if not domains:
            raise ValidationError("domains 不能为空")

        for d in domains:
            target_domains.add(d)
            items.append({"domain": d, "zone_id": "", "mode": "clear"})
    else:  # custom
        if not payload.records:
            raise ValidationError("records 不能为空")

        for r in payload.records:
            d = _normalize_domain(r.domain)
            if not d:
                continue
            target_domains.add(d)
            items.append(
                {
                    "domain": d,
                    "zone_id": "",
                    "mode": "custom",
                    "record_type": r.type.strip().upper(),
                    "record_name": _build_record_fqdn(r.name, d),
                    "record_value": r.value,
                }
            )

    if not items:
        raise ValidationError("没有可执行的删除项")

    zone_map = await _get_zone_map(db, account_uuid, target_domains)
    if len(zone_map) < len(target_domains):
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

    for item in items:
        item["zone_id"] = zone_map.get(item["domain"], "")

    await ensure_quota_for_batch(current_user, items=len(items))
    engine = TaskEngine(redis)
    task_id = await engine.create_task(
        "dns_delete",
        items,
        metadata={"account_id": str(account_uuid), "mode": payload.mode},
        user_id=str(current_user.id),
    )

    async def executor(item: dict) -> dict:
        domain = item.get("domain") or ""
        zone_id = item.get("zone_id") or ""
        mode = item.get("mode") or ""
        if not zone_id:
            raise Exception(f"未找到 Zone：{domain}（请先刷新域名缓存）")

        try:
            if mode == "clear":
                records = await _list_all_dns_records(client, zone_id)
            else:
                records = await _list_all_dns_records(
                    client,
                    zone_id,
                    type=item.get("record_type"),
                    name=item.get("record_name"),
                )
                wanted_value = item.get("record_value")
                if wanted_value:
                    records = [r for r in records if str(r.get("content") or "") == str(wanted_value)]

            if not records:
                return {"message": "未找到可删除记录"}

            deleted = 0
            for r in records:
                record_id = str(r.get("id") or "").strip()
                if not record_id:
                    continue
                await client.delete_dns_record(zone_id, record_id)
                deleted += 1
            return {"message": f"已删除 {deleted} 条"}
        except CloudflareAPIError as e:
            if e.status_code in {401, 403}:
                raise FatalTaskError(str(e)) from e
            raise

    before_item, after_item = make_task_hooks(user_id=str(current_user.id), task_type="dns_delete", task_id=task_id)
    await engine.start_background_execution(task_id, executor, before_item=before_item, after_item=after_item)
    return TaskCreateResponse(task_id=task_id, total=len(items))


@router.post("/proxy", response_model=TaskCreateResponse, status_code=202)
async def set_proxied(
    payload: DnsProxyRequest,
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

    record_name_raw = payload.record_name.strip()
    record_name_all = record_name_raw.lower() == "@all"
    record_type = payload.record_type.strip().upper() if payload.record_type else None

    items: list[dict[str, Any]] = []
    for d in domains:
        items.append(
            {
                "domain": d,
                "zone_id": zone_map.get(d, ""),
                "record_name": "@all" if record_name_all else _build_record_fqdn(record_name_raw, d),
                "record_type": record_type,
                "proxied": payload.proxied,
            }
        )

    await ensure_quota_for_batch(current_user, items=len(items))
    engine = TaskEngine(redis)
    task_id = await engine.create_task(
        "dns_proxy",
        items,
        metadata={
            "account_id": str(account_uuid),
            "mode": f"proxied={'on' if payload.proxied else 'off'} {record_name_raw} {(record_type or '*')}",
        },
        user_id=str(current_user.id),
    )

    async def executor(item: dict) -> dict:
        domain = item.get("domain") or ""
        zone_id = item.get("zone_id") or ""
        if not zone_id:
            raise Exception(f"未找到 Zone：{domain}（请先刷新域名缓存）")

        try:
            params: dict[str, Any] = {}
            if item.get("record_type"):
                params["type"] = item["record_type"]
            if item.get("record_name") != "@all":
                params["name"] = item["record_name"]

            records = await _list_all_dns_records(client, zone_id, **params)
            if item.get("record_name") == "@all":
                # 仅处理支持 proxied 的类型（A/AAAA/CNAME 等，API 会返回 proxied 字段）
                records = [r for r in records if r.get("proxied") is not None]

            if not records:
                return {"message": "未找到可更新记录"}

            updated = 0
            skipped = 0
            for r in records:
                record_id = str(r.get("id") or "").strip()
                if not record_id:
                    skipped += 1
                    continue
                update_payload: dict[str, Any] = {
                    "type": r.get("type"),
                    "name": r.get("name"),
                    "content": r.get("content"),
                    "ttl": r.get("ttl", 1),
                    "proxied": bool(item.get("proxied")),
                }
                try:
                    await client.update_dns_record(zone_id, record_id, update_payload)
                    updated += 1
                except CloudflareAPIError:
                    skipped += 1
            return {"message": f"已更新 {updated} 条（跳过 {skipped} 条）"}
        except CloudflareAPIError as e:
            if e.status_code in {401, 403}:
                raise FatalTaskError(str(e)) from e
            raise

    before_item, after_item = make_task_hooks(user_id=str(current_user.id), task_type="dns_proxy", task_id=task_id)
    await engine.start_background_execution(task_id, executor, before_item=before_item, after_item=after_item)
    return TaskCreateResponse(task_id=task_id, total=len(items))
