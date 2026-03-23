from __future__ import annotations

import json
import uuid
from copy import deepcopy
from typing import Any, Callable, Coroutine

import httpx
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import get_credential_encryption
from app.core.exceptions import FatalTaskError, ForbiddenError, NotFoundError, ValidationError
from app.models.account import CFAccount
from app.models.user import User
from app.services.billing import ensure_quota_for_batch, make_task_hooks
from app.services.cloudflare.client import CloudflareAPIError, CloudflareClient
from app.services.task_engine import TaskEngine

# 复用各业务模块的内部实现，避免重复写逻辑
from app.api.v1.domains import DomainCacheBatchWriter, _delete_domain_cache, _invalidate_domain_cache, _is_zone_exists_error, _upsert_domain_cache
from app.api.v1.dns import _is_duplicate_record_error, _list_all_dns_records
from app.api.v1.rules import RULESET_PHASES, _deep_replace_domain


def _safe_json_loads(raw: str) -> Any:  # noqa: ANN401
    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        return None


def _parse_uuid(value: str, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError as e:
        raise ValidationError(f"{field} 格式错误") from e


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


async def _extract_failed_items(redis: Redis, task_id: str) -> list[dict[str, Any]]:
    raw_rows = await redis.lrange(f"task:{task_id}:results", 0, -1)
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_rows:
        try:
            row = json.loads(raw)
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(row, dict):
            continue
        if str(row.get("status") or "").strip().lower() != "error":
            continue
        detail_raw = row.get("detail")
        if not isinstance(detail_raw, str) or not detail_raw:
            continue
        detail = _safe_json_loads(detail_raw)
        if not isinstance(detail, dict):
            continue
        item = detail.get("item")
        if not isinstance(item, dict):
            continue
        key = json.dumps(item, ensure_ascii=False, sort_keys=True, default=str)
        if key in seen:
            continue
        seen.add(key)
        items.append(item)
    return items


Executor = Callable[[dict], Coroutine[Any, Any, dict]]


def _build_executor(
    *,
    task_type: str,
    client: CloudflareClient,
    redis: Redis,
    account_id: uuid.UUID,
    domain_cache_writer: DomainCacheBatchWriter | None = None,
) -> Executor:
    if task_type == "domain_add":

        async def executor(item: dict) -> dict:
            domain = str(item.get("domain") or "").strip()
            if not domain:
                raise Exception("域名为空")

            try:
                data = await client.create_zone(domain, jump_start=True)
                result = data.get("result") or {}
                zone_id = str(result.get("id") or "").strip()
                zone_status = str(result.get("status") or "").strip() or "unknown"
                if zone_id:
                    if domain_cache_writer:
                        await domain_cache_writer.upsert(
                            domain=domain,
                            zone_id=zone_id,
                            status=zone_status,
                            name_servers=result.get("name_servers") or None,
                        )
                    else:
                        await _upsert_domain_cache(
                            account_id=account_id,
                            domain=domain,
                            zone_id=zone_id,
                            status=zone_status,
                            name_servers=result.get("name_servers") or None,
                        )
                        await _invalidate_domain_cache(redis, account_id)
                return {
                    "message": "创建成功",
                    "zone_id": zone_id,
                    "zone_status": zone_status,
                    "name_servers": result.get("name_servers"),
                }
            except CloudflareAPIError as e:
                if e.status_code in {401, 403}:
                    raise FatalTaskError(str(e)) from e
                if _is_zone_exists_error(e):
                    await _invalidate_domain_cache(redis, account_id)
                    return {"message": "已存在"}
                raise

        return executor

    if task_type == "domain_delete":

        async def executor(item: dict) -> dict:
            domain = str(item.get("domain") or "").strip()
            zone_id = str(item.get("zone_id") or "").strip()
            if not zone_id:
                raise Exception(f"未找到 Zone：{domain}（请先刷新域名缓存）")

            try:
                await client.delete_zone(zone_id)
                if domain_cache_writer:
                    await domain_cache_writer.delete(domain=domain)
                else:
                    await _delete_domain_cache(account_id=account_id, domain=domain)
                    await _invalidate_domain_cache(redis, account_id)
                return {"message": "删除成功"}
            except CloudflareAPIError as e:
                if e.status_code in {401, 403}:
                    raise FatalTaskError(str(e)) from e
                if e.status_code == 404:
                    if domain_cache_writer:
                        await domain_cache_writer.delete(domain=domain)
                    else:
                        await _delete_domain_cache(account_id=account_id, domain=domain)
                        await _invalidate_domain_cache(redis, account_id)
                    return {"message": "已不存在"}
                raise

        return executor

    if task_type == "dns_resolve":

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

        return executor

    if task_type == "dns_replace":

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

        return executor

    if task_type == "dns_delete":

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

        return executor

    if task_type == "dns_proxy":

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

        return executor

    if task_type == "cache_batch":
        from app.api.v1.cache import _bool_to_on_off

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

        return executor

    if task_type == "cache_purge":

        def _normalize_purge_files(domain: str, raw_files: list[str]) -> list[str]:
            out: list[str] = []
            for raw in raw_files:
                f = str(raw).strip()
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

        return executor

    if task_type == "ssl_batch":
        from app.api.v1.ssl import _bool_to_on_off

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

        return executor

    if task_type == "speed_batch":
        from app.api.v1.speed import _bool_to_on_off

        async def executor(item: dict) -> dict:
            domain = item.get("domain") or ""
            zone_id = item.get("zone_id") or ""
            if not zone_id:
                raise Exception(f"未找到 Zone：{domain}（请先刷新域名缓存）")

            raw = item.get("settings") or {}
            updates: list[tuple[str, Any]] = []
            if raw.get("brotli") is not None:
                updates.append(("brotli", _bool_to_on_off(bool(raw["brotli"]))))
            if raw.get("rocket_loader") is not None:
                updates.append(("rocket_loader", raw["rocket_loader"]))
            if raw.get("speed_brain") is not None:
                updates.append(("speed_brain", _bool_to_on_off(bool(raw["speed_brain"]))))
            if raw.get("cloudflare_fonts") is not None:
                updates.append(("cloudflare_fonts", _bool_to_on_off(bool(raw["cloudflare_fonts"]))))
            if raw.get("early_hints") is not None:
                updates.append(("early_hints", _bool_to_on_off(bool(raw["early_hints"]))))
            if raw.get("zero_rtt") is not None:
                updates.append(("0rtt", _bool_to_on_off(bool(raw["zero_rtt"]))))
            if raw.get("polish") is not None:
                updates.append(("polish", raw["polish"]))
            if raw.get("mirage") is not None:
                updates.append(("mirage", _bool_to_on_off(bool(raw["mirage"]))))

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

        return executor

    if task_type == "other_batch":
        from app.api.v1.other import _bool_to_on_off

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

        return executor

    if task_type == "rules_clone":
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

        return executor

    if task_type == "rules_delete":

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

                phase = str(item.get("phase") or "").strip() or RULESET_PHASES.get(str(rule_type or ""))
                if not phase:
                    return {"message": f"未识别规则类型：{rule_type}"}
                try:
                    data = await client.get_ruleset_entrypoint(zone_id, phase)
                    rs = data.get("result") or {}
                    rs["rules"] = []
                    update_payload = {k: v for k, v in rs.items() if k in {"name", "description", "kind", "phase", "rules"}}
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

        return executor

    raise ValidationError(f"不支持重试该任务类型：{task_type}")


async def retry_failed_task(
    *,
    task_id: str,
    user: User,
    db: AsyncSession,
    redis: Redis,
    http: httpx.AsyncClient,
) -> dict:
    task = await redis.hgetall(f"task:{task_id}")
    if not task:
        raise NotFoundError("任务不存在")
    owner_id = str(task.get("user_id") or "").strip()
    if not owner_id:
        raise NotFoundError("任务不存在")
    if owner_id != str(user.id):
        raise ForbiddenError("无权访问该任务")

    task_type = str(task.get("type") or "").strip()
    if not task_type:
        raise ValidationError("任务类型缺失，无法重试")

    status = str(task.get("status") or "").strip().lower()
    if status in {"pending", "running", "cancelling"}:
        raise ValidationError("任务进行中，暂不支持重试失败项")

    meta_raw = task.get("metadata") or ""
    meta_obj = _safe_json_loads(str(meta_raw)) if meta_raw else {}
    if not isinstance(meta_obj, dict):
        meta_obj = {}

    account_id_raw = str(meta_obj.get("account_id") or "").strip()
    if not account_id_raw:
        raise ValidationError("任务缺少 account_id，无法重试")
    account_uuid = _parse_uuid(account_id_raw, "account_id")
    account = await _get_account_or_404(db, user.id, account_uuid)

    items = await _extract_failed_items(redis, task_id)
    if not items:
        raise ValidationError("没有失败项可重试")

    await ensure_quota_for_batch(user, items=len(items))

    credentials = get_credential_encryption().decrypt(account.encrypted_credentials)
    client = CloudflareClient(
        credential_type=account.credential_type,
        credentials=credentials,
        http_client=http,
        redis=redis,
    )

    engine = TaskEngine(redis)
    new_meta = {**meta_obj, "retry_from": task_id}
    new_task_id = await engine.create_task(task_type, items, metadata=new_meta, user_id=str(user.id))
    cache_writer = (
        DomainCacheBatchWriter(account_id=account_uuid, redis=redis) if task_type in {"domain_add", "domain_delete"} else None
    )
    executor = _build_executor(
        task_type=task_type,
        client=client,
        redis=redis,
        account_id=account_uuid,
        domain_cache_writer=cache_writer,
    )
    before_item, after_item = make_task_hooks(user_id=str(user.id), task_type=task_type, task_id=new_task_id)
    await engine.start_background_execution(
        new_task_id,
        executor,
        before_item=before_item,
        after_item=after_item,
        on_finish=cache_writer.close if cache_writer else None,
    )
    return {"task_id": new_task_id, "total": len(items)}
