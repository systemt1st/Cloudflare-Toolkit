from __future__ import annotations

import httpx
import uuid
from copy import deepcopy
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
from app.schemas.rules import RulesCloneRequest, RulesDeleteRequest, RulesReadRequest, RulesReadResponse
from app.schemas.task import TaskCreateResponse
from app.services.billing import ensure_quota_for_batch, make_task_hooks
from app.services.cloudflare.client import CloudflareAPIError, CloudflareClient
from app.services.task_engine import TaskEngine

router = APIRouter()


RULESET_PHASES: dict[str, str] = {
    "redirect_rules": "http_request_dynamic_redirect",
    "cache_rules": "http_request_cache_settings",
}


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


def _deep_replace_domain(obj: Any, source_domain: str, target_domain: str) -> Any:  # noqa: ANN401
    if isinstance(obj, str):
        return obj.replace(source_domain, target_domain)
    if isinstance(obj, list):
        return [_deep_replace_domain(x, source_domain, target_domain) for x in obj]
    if isinstance(obj, dict):
        return {k: _deep_replace_domain(v, source_domain, target_domain) for k, v in obj.items()}
    return obj


async def _resolve_zone_id(client: CloudflareClient, db: AsyncSession, account_id: uuid.UUID, domain: str) -> str:
    zone_map = await _get_zone_map(db, account_id, {domain})
    if zone_map.get(domain):
        return zone_map[domain]

    zones = await client.list_all_zones()
    for z in zones:
        name = _normalize_domain(str(z.get("name", "")))
        zone_id = str(z.get("id", "")).strip()
        if name == domain and zone_id:
            return zone_id
    return ""


@router.post("/read", response_model=RulesReadResponse)
async def read_rules(
    payload: RulesReadRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> RulesReadResponse:
    account_uuid = _parse_uuid(payload.account_id, "account_id")
    account = await _get_account_or_404(db, current_user.id, account_uuid)
    source_domain = _normalize_domain(payload.source_domain)
    if not source_domain:
        raise ValidationError("source_domain 不能为空")

    credentials = get_credential_encryption().decrypt(account.encrypted_credentials)
    client = CloudflareClient(
        credential_type=account.credential_type,
        credentials=credentials,
        http_client=http,
        redis=redis,
    )

    try:
        zone_id = await _resolve_zone_id(client, db, account_uuid, source_domain)
    except CloudflareAPIError as e:
        if e.status_code in {401, 403}:
            raise ValidationError("Cloudflare 凭据无效或无权限") from e
        raise ValidationError(str(e)) from e

    if not zone_id:
        raise ValidationError("未找到源域名 Zone（请先刷新域名缓存）")

    rules: dict[str, list[dict]] = {}
    for rule_type in payload.rule_types:
        if rule_type == "page_rules":
            try:
                data = await client.list_page_rules(zone_id)
                raw = data.get("result") or []
            except CloudflareAPIError as e:
                raise ValidationError(str(e)) from e
            rules["page_rules"] = [
                {
                    "id": r.get("id"),
                    "targets": r.get("targets"),
                    "actions": r.get("actions"),
                    "priority": r.get("priority"),
                    "status": r.get("status"),
                }
                for r in raw
            ]
            continue

        phase = RULESET_PHASES.get(rule_type)
        if not phase:
            rules[rule_type] = []
            continue
        try:
            data = await client.get_ruleset_entrypoint(zone_id, phase)
            rs = data.get("result") or {}
            rules[rule_type] = rs.get("rules") or []
        except CloudflareAPIError as e:
            if e.status_code == 404:
                rules[rule_type] = []
                continue
            raise ValidationError(str(e)) from e

    return RulesReadResponse(domain=source_domain, rules=rules)


@router.post("/clone", response_model=TaskCreateResponse, status_code=202)
async def clone_rules(
    payload: RulesCloneRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> TaskCreateResponse:
    account_uuid = _parse_uuid(payload.account_id, "account_id")
    account = await _get_account_or_404(db, current_user.id, account_uuid)

    source_domain = _normalize_domain(payload.source_domain)
    if not source_domain:
        raise ValidationError("source_domain 不能为空")

    targets = [_normalize_domain(x) for x in payload.target_domains]
    targets = [x for x in targets if x]
    targets = list(dict.fromkeys(targets))
    if not targets:
        raise ValidationError("target_domains 不能为空")

    credentials = get_credential_encryption().decrypt(account.encrypted_credentials)
    client = CloudflareClient(
        credential_type=account.credential_type,
        credentials=credentials,
        http_client=http,
        redis=redis,
    )

    zone_map = await _get_zone_map(db, account_uuid, set([source_domain, *targets]))
    if len(zone_map) < len({source_domain, *targets}):
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

    source_zone_id = zone_map.get(source_domain, "")
    if not source_zone_id:
        raise ValidationError("未找到源域名 Zone（请先刷新域名缓存）")

    selected_rules = payload.selected_rules or {}

    source_rules: dict[str, list[dict]] = {}
    for rule_type in payload.rule_types:
        if rule_type == "page_rules":
            try:
                data = await client.list_page_rules(source_zone_id)
                raw = data.get("result") or []
            except CloudflareAPIError as e:
                raise ValidationError(str(e)) from e
            source_rules["page_rules"] = [
                {
                    "id": r.get("id"),
                    "targets": r.get("targets"),
                    "actions": r.get("actions"),
                    "priority": r.get("priority"),
                    "status": r.get("status"),
                }
                for r in raw
            ]
            continue

        phase = RULESET_PHASES.get(rule_type)
        if not phase:
            source_rules[rule_type] = []
            continue
        try:
            data = await client.get_ruleset_entrypoint(source_zone_id, phase)
            rs = data.get("result") or {}
            source_rules[rule_type] = rs.get("rules") or []
        except CloudflareAPIError as e:
            if e.status_code == 404:
                source_rules[rule_type] = []
                continue
            raise ValidationError(str(e)) from e

    items: list[dict[str, Any]] = []
    for d in targets:
        zone_id = zone_map.get(d, "")
        for rule_type in payload.rule_types:
            rules = source_rules.get(rule_type) or []
            want_ids = set((selected_rules.get(rule_type) or []) if selected_rules else [])
            picked = [r for r in rules if not want_ids or str(r.get("id") or "") in want_ids]
            for r in picked:
                item: dict[str, Any] = {
                    "domain": d,
                    "zone_id": zone_id,
                    "rule_type": rule_type,
                    "rule": r,
                    "source_domain": source_domain,
                }
                if rule_type != "page_rules":
                    item["phase"] = RULESET_PHASES.get(rule_type)
                items.append(item)

    if not items:
        raise ValidationError("没有可克隆的规则")

    await ensure_quota_for_batch(current_user, items=len(items))
    engine = TaskEngine(redis)
    mode = f"{source_domain}({','.join(payload.rule_types)})"
    task_id = await engine.create_task(
        "rules_clone",
        items,
        metadata={"account_id": str(account_uuid), "source_domain": source_domain, "mode": mode},
        user_id=str(current_user.id),
    )

    entrypoint_cache: dict[tuple[str, str], dict[str, Any]] = {}

    async def executor(item: dict) -> dict:
        domain = item.get("domain") or ""
        zone_id = item.get("zone_id") or ""
        rule_type = item.get("rule_type") or ""
        rule = item.get("rule") or {}
        source = item.get("source_domain") or ""
        if not zone_id:
            raise Exception(f"未找到 Zone：{domain}（请先刷新域名缓存）")

        try:
            if rule_type == "page_rules":
                payload_obj = deepcopy(rule)
                payload_obj.pop("id", None)
                payload_obj = _deep_replace_domain(payload_obj, source, domain)
                await client.create_page_rule(zone_id, payload_obj)
                return {"message": "已克隆 Page Rules"}

            phase = str(item.get("phase") or "").strip()
            if not phase:
                raise Exception("缺少 ruleset phase")

            cache_key = (zone_id, phase)
            if cache_key not in entrypoint_cache:
                data = await client.get_ruleset_entrypoint(zone_id, phase)
                entrypoint_cache[cache_key] = data.get("result") or {}

            rs = entrypoint_cache[cache_key]
            rs_rules = rs.get("rules") or []
            cloned = deepcopy(rule)
            cloned.pop("id", None)
            cloned = _deep_replace_domain(cloned, source, domain)
            rs_rules.append(cloned)
            rs["rules"] = rs_rules

            update_payload = {k: v for k, v in rs.items() if k in {"name", "description", "kind", "phase", "rules"}}
            if "rules" not in update_payload:
                update_payload["rules"] = rs_rules
            await client.update_ruleset_entrypoint(zone_id, phase, update_payload)
            return {"message": f"已克隆 {rule_type}"}
        except CloudflareAPIError as e:
            if e.status_code in {401, 403}:
                raise FatalTaskError(str(e)) from e
            raise

    before_item, after_item = make_task_hooks(user_id=str(current_user.id), task_type="rules_clone", task_id=task_id)
    await engine.start_background_execution(task_id, executor, before_item=before_item, after_item=after_item)
    return TaskCreateResponse(task_id=task_id, total=len(items))


@router.post("/delete", response_model=TaskCreateResponse, status_code=202)
async def delete_rules(
    payload: RulesDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> TaskCreateResponse:
    if not payload.confirm:
        raise ValidationError("delete 需要 confirm=true")

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

    items: list[dict[str, Any]] = []
    for d in domains:
        for rule_type in payload.rule_types:
            item: dict[str, Any] = {"domain": d, "zone_id": zone_map.get(d, ""), "rule_type": rule_type}
            if rule_type != "page_rules":
                item["phase"] = RULESET_PHASES.get(rule_type)
            items.append(item)

    await ensure_quota_for_batch(current_user, items=len(items))
    engine = TaskEngine(redis)
    mode = ",".join(payload.rule_types)
    task_id = await engine.create_task(
        "rules_delete",
        items,
        metadata={"account_id": str(account_uuid), "mode": mode},
        user_id=str(current_user.id),
    )

    async def executor(item: dict) -> dict:
        domain = item.get("domain") or ""
        zone_id = item.get("zone_id") or ""
        rule_type = item.get("rule_type") or ""
        if not zone_id:
            raise Exception(f"未找到 Zone：{domain}（请先刷新域名缓存）")

        try:
            if rule_type == "page_rules":
                data = await client.list_page_rules(zone_id)
                rules = data.get("result") or []
                deleted = 0
                for r in rules:
                    rid = str(r.get("id") or "").strip()
                    if not rid:
                        continue
                    await client.delete_page_rule(zone_id, rid)
                    deleted += 1
                return {"message": f"已删除 {deleted} 条 Page Rules"}

            phase = str(item.get("phase") or "").strip()
            if not phase:
                return {"message": f"未识别规则类型：{rule_type}"}
            try:
                data = await client.get_ruleset_entrypoint(zone_id, phase)
                rs = data.get("result") or {}
                rs["rules"] = []
                update_payload = {
                    k: v for k, v in rs.items() if k in {"name", "description", "kind", "phase", "rules"}
                }
                update_payload["rules"] = []
                await client.update_ruleset_entrypoint(zone_id, phase, update_payload)
                return {"message": f"已清空 {rule_type}"}
            except CloudflareAPIError as e:
                if e.status_code == 404:
                    return {"message": f"{rule_type} 无可清空规则"}
                raise
        except CloudflareAPIError as e:
            if e.status_code in {401, 403}:
                raise FatalTaskError(str(e)) from e
            raise

    before_item, after_item = make_task_hooks(user_id=str(current_user.id), task_type="rules_delete", task_id=task_id)
    await engine.start_background_execution(task_id, executor, before_item=before_item, after_item=after_item)
    return TaskCreateResponse(task_id=task_id, total=len(items))
