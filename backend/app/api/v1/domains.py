from __future__ import annotations

import httpx
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from redis.asyncio import Redis
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_http_client, get_redis
from app.core.encryption import get_credential_encryption
from app.core.exceptions import FatalTaskError, NotFoundError, ValidationError
from app.database import SessionLocal, get_db
from app.models.account import CFAccount
from app.models.domain_cache import DomainCache
from app.models.user import User
from app.schemas.domain import DomainAddRequest, DomainCacheItem, DomainDeleteRequest
from app.schemas.task import TaskCreateResponse
from app.services.cloudflare.client import CloudflareAPIError, CloudflareClient
from app.services.billing import ensure_quota_for_batch, make_task_hooks
from app.services.task_engine import TaskEngine
from app.utils.csv_export import export_csv

from fastapi.responses import Response

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


def _unique_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for v in values:
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


def _is_zone_exists_error(exc: CloudflareAPIError) -> bool:
    for err in exc.errors:
        message = str(err.get("message", "")).lower()
        if "already exists" in message:
            return True
    return False


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


def _domain_cache_key(account_id: uuid.UUID) -> str:
    return f"account:{account_id}:domains"


async def _invalidate_domain_cache(redis: Redis, account_id: uuid.UUID) -> None:
    try:
        await redis.delete(_domain_cache_key(account_id))
    except Exception:  # noqa: BLE001
        pass


class DomainCacheBatchWriter:
    def __init__(self, *, account_id: uuid.UUID, redis: Redis, flush_every: int = 25):
        self.account_id = account_id
        self.redis = redis
        self.flush_every = max(1, int(flush_every or 25))
        self._db: AsyncSession | None = None
        self._pending_upserts: dict[str, dict[str, Any]] = {}
        self._pending_deletes: set[str] = set()
        self._dirty = False

    async def _ensure_db(self) -> AsyncSession:
        if self._db is None:
            self._db = SessionLocal()
        return self._db

    def _pending_count(self) -> int:
        return len(self._pending_upserts) + len(self._pending_deletes)

    async def upsert(
        self,
        *,
        domain: str,
        zone_id: str,
        status: str,
        name_servers: list[str] | None,
    ) -> None:
        domain = str(domain or "").strip().lower().rstrip(".")
        if not domain:
            return
        zone_id = str(zone_id or "").strip()
        if not zone_id:
            return
        self._pending_deletes.discard(domain)
        self._pending_upserts[domain] = {
            "account_id": self.account_id,
            "domain": domain,
            "zone_id": zone_id,
            "status": status or "unknown",
            "name_servers": name_servers,
            "cached_at": datetime.now(timezone.utc),
            "deleted_at": None,
        }
        self._dirty = True
        if self._pending_count() >= self.flush_every:
            await self.flush()

    async def delete(self, *, domain: str) -> None:
        domain = str(domain or "").strip().lower().rstrip(".")
        if not domain:
            return
        self._pending_upserts.pop(domain, None)
        self._pending_deletes.add(domain)
        self._dirty = True
        if self._pending_count() >= self.flush_every:
            await self.flush()

    async def flush(self) -> None:
        if not self._dirty:
            return
        db = await self._ensure_db()

        try:
            if self._pending_deletes:
                await db.execute(
                    delete(DomainCache).where(
                        DomainCache.account_id == self.account_id,
                        DomainCache.domain.in_(sorted(self._pending_deletes)),
                    )
                )

            if self._pending_upserts:
                rows = list(self._pending_upserts.values())
                stmt = pg_insert(DomainCache).values(rows)
                stmt = stmt.on_conflict_do_update(
                    index_elements=[DomainCache.account_id, DomainCache.domain],
                    index_where=DomainCache.deleted_at.is_(None),
                    set_={
                        "zone_id": stmt.excluded.zone_id,
                        "status": stmt.excluded.status,
                        "name_servers": stmt.excluded.name_servers,
                        "cached_at": stmt.excluded.cached_at,
                        "deleted_at": None,
                    },
                )
                await db.execute(stmt)

            await db.commit()
        except Exception:  # noqa: BLE001
            try:
                await db.rollback()
            except Exception:  # noqa: BLE001
                pass
        finally:
            self._pending_upserts.clear()
            self._pending_deletes.clear()
            if self._dirty:
                await _invalidate_domain_cache(self.redis, self.account_id)
            self._dirty = False

    async def close(self) -> None:
        try:
            await self.flush()
        finally:
            if self._db is not None:
                try:
                    await self._db.close()
                except Exception:  # noqa: BLE001
                    pass
                self._db = None


async def _upsert_domain_cache(
    *,
    account_id: uuid.UUID,
    domain: str,
    zone_id: str,
    status: str,
    name_servers: list[str] | None,
) -> None:
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        stmt = pg_insert(DomainCache).values(
            {
                "account_id": account_id,
                "domain": domain,
                "zone_id": zone_id,
                "status": status or "unknown",
                "name_servers": name_servers,
                "cached_at": now,
                "deleted_at": None,
            }
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=[DomainCache.account_id, DomainCache.domain],
            index_where=DomainCache.deleted_at.is_(None),
            set_={
                "zone_id": stmt.excluded.zone_id,
                "status": stmt.excluded.status,
                "name_servers": stmt.excluded.name_servers,
                "cached_at": stmt.excluded.cached_at,
                "deleted_at": None,
            },
        )
        await db.execute(stmt)
        await db.commit()


async def _delete_domain_cache(*, account_id: uuid.UUID, domain: str) -> None:
    async with SessionLocal() as db:
        await db.execute(delete(DomainCache).where(DomainCache.account_id == account_id, DomainCache.domain == domain))
        await db.commit()


@router.post("/add", response_model=TaskCreateResponse, status_code=202)
async def batch_add_domains(
    payload: DomainAddRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> TaskCreateResponse:
    account_uuid = _parse_uuid(payload.account_id, "account_id")
    account = await _get_account_or_404(db, current_user.id, account_uuid)

    domains = [_normalize_domain(x) for x in payload.domains]
    domains = [d for d in domains if d]
    domains = _unique_keep_order(domains)
    if not domains:
        raise ValidationError("domains 不能为空")
    credentials = get_credential_encryption().decrypt(account.encrypted_credentials)
    client = CloudflareClient(
        credential_type=account.credential_type,
        credentials=credentials,
        http_client=http,
        redis=redis,
    )

    items: list[dict[str, Any]] = [{"domain": d} for d in domains]
    await ensure_quota_for_batch(current_user, items=len(items))
    engine = TaskEngine(redis)
    task_id = await engine.create_task(
        "domain_add",
        items,
        metadata={"account_id": str(account_uuid), "mode": "jump_start"},
        user_id=str(current_user.id),
    )

    cache_writer = DomainCacheBatchWriter(account_id=account_uuid, redis=redis)

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
                await cache_writer.upsert(
                    domain=domain,
                    zone_id=zone_id,
                    status=zone_status,
                    name_servers=result.get("name_servers") or None,
                )
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
                await _invalidate_domain_cache(redis, account_uuid)
                return {"message": "已存在"}
            raise

    before_item, after_item = make_task_hooks(user_id=str(current_user.id), task_type="domain_add", task_id=task_id)
    await engine.start_background_execution(
        task_id,
        executor,
        before_item=before_item,
        after_item=after_item,
        on_finish=cache_writer.close,
    )
    return TaskCreateResponse(task_id=task_id, total=len(items))


@router.post("/delete", response_model=TaskCreateResponse, status_code=202)
async def batch_delete_domains(
    payload: DomainDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> TaskCreateResponse:
    account_uuid = _parse_uuid(payload.account_id, "account_id")
    account = await _get_account_or_404(db, current_user.id, account_uuid)

    domains = [_normalize_domain(x) for x in payload.domains]
    domains = [d for d in domains if d]
    domains = _unique_keep_order(domains)
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

    items: list[dict[str, Any]] = [{"domain": d, "zone_id": zone_map.get(d, "")} for d in domains]
    await ensure_quota_for_batch(current_user, items=len(items))
    engine = TaskEngine(redis)
    task_id = await engine.create_task(
        "domain_delete",
        items,
        metadata={"account_id": str(account_uuid), "mode": "delete_zone"},
        user_id=str(current_user.id),
    )

    cache_writer = DomainCacheBatchWriter(account_id=account_uuid, redis=redis)

    async def executor(item: dict) -> dict:
        domain = str(item.get("domain") or "").strip()
        zone_id = str(item.get("zone_id") or "").strip()
        if not zone_id:
            raise Exception(f"未找到 Zone：{domain}（请先刷新域名缓存）")

        try:
            await client.delete_zone(zone_id)
            await cache_writer.delete(domain=domain)
            return {"message": "删除成功"}
        except CloudflareAPIError as e:
            if e.status_code in {401, 403}:
                raise FatalTaskError(str(e)) from e
            if e.status_code == 404:
                await cache_writer.delete(domain=domain)
                return {"message": "已不存在"}
            raise

    before_item, after_item = make_task_hooks(user_id=str(current_user.id), task_type="domain_delete", task_id=task_id)
    await engine.start_background_execution(
        task_id,
        executor,
        before_item=before_item,
        after_item=after_item,
        on_finish=cache_writer.close,
    )
    return TaskCreateResponse(task_id=task_id, total=len(items))


@router.get("/export")
async def export_domains(
    account_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> Response:
    account_uuid = _parse_uuid(account_id, "account_id")
    account = await _get_account_or_404(db, current_user.id, account_uuid)

    credentials = get_credential_encryption().decrypt(account.encrypted_credentials)
    client = CloudflareClient(
        credential_type=account.credential_type,
        credentials=credentials,
        http_client=http,
        redis=redis,
    )

    try:
        zones = await client.list_all_zones()
    except CloudflareAPIError as e:
        if e.status_code in {401, 403}:
            raise ValidationError("Cloudflare 凭据无效或无权限") from e
        raise ValidationError(str(e)) from e

    rows: list[dict[str, Any]] = []
    for z in zones:
        rows.append(
            {
                "domain": z.get("name"),
                "status": z.get("status"),
                "created_on": z.get("created_on"),
            }
        )

    csv_text = export_csv(rows, headers=["domain", "status", "created_on"])
    content = "\ufeff" + csv_text
    filename = f"domains-{account_uuid}.csv"
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/pending", response_model=list[DomainCacheItem])
async def list_pending_domains(
    account_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DomainCacheItem]:
    account_uuid = _parse_uuid(account_id, "account_id")
    await _get_account_or_404(db, current_user.id, account_uuid)

    result = await db.execute(
        select(DomainCache)
        .where(DomainCache.account_id == account_uuid, DomainCache.status.in_(["pending", "initializing"]))
        .order_by(DomainCache.domain.asc())
    )
    rows = result.scalars().all()
    return [
        DomainCacheItem(
            domain=r.domain,
            zone_id=r.zone_id,
            status=r.status,
            name_servers=r.name_servers,
            cached_at=r.cached_at,
        )
        for r in rows
    ]
