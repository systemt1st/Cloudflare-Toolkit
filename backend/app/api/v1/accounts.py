from __future__ import annotations

import httpx
from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends

from redis.asyncio import Redis
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_http_client, get_redis
from app.core.encryption import get_credential_encryption
from app.core.exceptions import NotFoundError, ValidationError
from app.database import get_db
from app.models.domain_cache import DomainCache
from app.models.account import CFAccount
from app.models.user import User
from app.schemas.account import AccountCreate, AccountPublic, AccountUpdate
from app.schemas.domain import DomainCacheItem, DomainCacheRefreshResponse
from app.services.cloudflare.client import CloudflareClient

router = APIRouter()


def _parse_uuid(value: str, field: str = "id") -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as e:
        raise ValidationError(f"{field} 格式错误") from e


def _domain_cache_key(account_id: uuid.UUID) -> str:
    return f"account:{account_id}:domains"


@router.get("", response_model=list[AccountPublic])
async def list_accounts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AccountPublic]:
    result = await db.execute(
        select(CFAccount)
        .where(CFAccount.user_id == current_user.id, CFAccount.deleted_at.is_(None))
        .order_by(CFAccount.created_at.desc())
    )
    rows = result.scalars().all()
    return [
        AccountPublic(id=str(a.id), name=a.name, credential_type=a.credential_type, created_at=a.created_at) for a in rows
    ]


@router.post("", response_model=AccountPublic, status_code=201)
async def create_account(
    payload: AccountCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AccountPublic:
    if payload.credential_type == "api_token" and "api_token" not in payload.credentials:
        raise ValidationError("credentials 缺少 api_token")
    if payload.credential_type == "global_key" and not {"email", "api_key"} <= set(payload.credentials.keys()):
        raise ValidationError("credentials 缺少 email/api_key")

    encrypted = get_credential_encryption().encrypt(payload.credentials)
    account = CFAccount(
        user_id=current_user.id,
        name=payload.name,
        credential_type=payload.credential_type,
        encrypted_credentials=encrypted,
    )
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return AccountPublic(
        id=str(account.id),
        name=account.name,
        credential_type=account.credential_type,  # type: ignore[arg-type]
        created_at=account.created_at,
    )


@router.get("/{account_id}", response_model=AccountPublic)
async def get_account(
    account_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AccountPublic:
    account_uuid = _parse_uuid(account_id, "account_id")
    result = await db.execute(
        select(CFAccount).where(
            CFAccount.id == account_uuid,
            CFAccount.user_id == current_user.id,
            CFAccount.deleted_at.is_(None),
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise NotFoundError("操作账户不存在")

    return AccountPublic(
        id=str(account.id),
        name=account.name,
        credential_type=account.credential_type,  # type: ignore[arg-type]
        created_at=account.created_at,
    )


@router.patch("/{account_id}", response_model=AccountPublic)
async def update_account(
    account_id: str,
    payload: AccountUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AccountPublic:
    account_uuid = _parse_uuid(account_id, "account_id")
    result = await db.execute(
        select(CFAccount).where(
            CFAccount.id == account_uuid,
            CFAccount.user_id == current_user.id,
            CFAccount.deleted_at.is_(None),
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise NotFoundError("操作账户不存在")

    if payload.name is not None:
        account.name = payload.name
    if payload.credential_type is not None:
        account.credential_type = payload.credential_type
    if payload.credentials is not None:
        account.encrypted_credentials = get_credential_encryption().encrypt(payload.credentials)

    await db.commit()
    await db.refresh(account)
    return AccountPublic(
        id=str(account.id),
        name=account.name,
        credential_type=account.credential_type,  # type: ignore[arg-type]
        created_at=account.created_at,
    )


@router.delete("/{account_id}", status_code=204)
async def delete_account(
    account_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    account_uuid = _parse_uuid(account_id, "account_id")
    result = await db.execute(
        select(CFAccount).where(
            CFAccount.id == account_uuid,
            CFAccount.user_id == current_user.id,
            CFAccount.deleted_at.is_(None),
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise NotFoundError("操作账户不存在")
    account.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/{account_id}/verify")
async def verify_account(
    account_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> dict:
    account_uuid = _parse_uuid(account_id, "account_id")
    result = await db.execute(
        select(CFAccount).where(
            CFAccount.id == account_uuid,
            CFAccount.user_id == current_user.id,
            CFAccount.deleted_at.is_(None),
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise NotFoundError("操作账户不存在")

    credentials = get_credential_encryption().decrypt(account.encrypted_credentials)
    client = CloudflareClient(
        credential_type=account.credential_type,
        credentials=credentials,
        http_client=http,
        redis=redis,
    )
    await client.verify_token()
    return {"verified": True}


@router.get("/{account_id}/domains", response_model=list[DomainCacheItem])
async def list_domains(
    account_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> list[DomainCacheItem]:
    account_uuid = _parse_uuid(account_id, "account_id")

    result = await db.execute(
        select(CFAccount).where(
            CFAccount.id == account_uuid,
            CFAccount.user_id == current_user.id,
            CFAccount.deleted_at.is_(None),
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise NotFoundError("操作账户不存在")

    key = _domain_cache_key(account_uuid)
    cached = await redis.get(key)
    if cached:
        try:
            import json

            items = json.loads(cached)
            return [DomainCacheItem(**x) for x in items]
        except Exception:  # noqa: BLE001
            # 解析失败则走 DB
            pass

    rows = await db.execute(select(DomainCache).where(DomainCache.account_id == account_uuid).order_by(DomainCache.domain.asc()))
    domains = rows.scalars().all()

    # DB 无缓存：自动刷新一次（避免首次使用还要先点刷新）
    if not domains:
        refreshed = await _refresh_domains_impl(account, db, redis, http)
        return refreshed

    items = [
        DomainCacheItem(
            domain=d.domain,
            zone_id=d.zone_id,
            status=d.status,
            name_servers=d.name_servers,
            cached_at=d.cached_at,
        )
        for d in domains
    ]
    import json

    await redis.setex(key, 60 * 30, json.dumps([i.model_dump(mode="json") for i in items], ensure_ascii=False))
    return items


async def _refresh_domains_impl(
    account: CFAccount, db: AsyncSession, redis: Redis, http: httpx.AsyncClient
) -> list[DomainCacheItem]:
    credentials = get_credential_encryption().decrypt(account.encrypted_credentials)
    client = CloudflareClient(
        credential_type=account.credential_type,
        credentials=credentials,
        http_client=http,
        redis=redis,
    )
    zones = await client.list_all_zones()

    now = datetime.now(timezone.utc)
    new_rows: list[DomainCache] = []
    items: list[DomainCacheItem] = []

    for z in zones:
        domain = str(z.get("name", "")).strip()
        zone_id = str(z.get("id", "")).strip()
        if not domain or not zone_id:
            continue
        status = str(z.get("status", "")).strip() or "unknown"
        name_servers = z.get("name_servers") or None

        new_rows.append(
            DomainCache(
                account_id=account.id,
                domain=domain,
                zone_id=zone_id,
                status=status,
                name_servers=name_servers,
                cached_at=now,
            )
        )
        items.append(
            DomainCacheItem(
                domain=domain,
                zone_id=zone_id,
                status=status,
                name_servers=name_servers,
                cached_at=now,
            )
        )

    await db.execute(delete(DomainCache).where(DomainCache.account_id == account.id))
    if new_rows:
        db.add_all(new_rows)
    await db.commit()

    import json

    key = _domain_cache_key(account.id)
    await redis.setex(key, 60 * 30, json.dumps([i.model_dump(mode="json") for i in items], ensure_ascii=False))
    return items


@router.post("/{account_id}/domains/refresh", response_model=DomainCacheRefreshResponse)
async def refresh_domains(
    account_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> DomainCacheRefreshResponse:
    account_uuid = _parse_uuid(account_id, "account_id")

    result = await db.execute(
        select(CFAccount).where(
            CFAccount.id == account_uuid,
            CFAccount.user_id == current_user.id,
            CFAccount.deleted_at.is_(None),
        )
    )
    account = result.scalar_one_or_none()
    if not account:
        raise NotFoundError("操作账户不存在")

    items = await _refresh_domains_impl(account, db, redis, http)
    return DomainCacheRefreshResponse(count=len(items), cached_at=datetime.now(timezone.utc))
