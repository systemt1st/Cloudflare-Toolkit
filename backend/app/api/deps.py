from __future__ import annotations

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import httpx
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import uuid

from app.config import settings
from app.core.csrf import require_csrf
from app.core.exceptions import RateLimitedError, UnauthorizedError
from app.core.security import verify_token
from app.database import get_db
from app.models.user import User
from app.services.billing import reset_monthly_credits_if_needed, sync_user_subscription

bearer_scheme = HTTPBearer(auto_error=False)


async def get_redis(request: Request) -> Redis:
    # Redis client 在应用生命周期内复用（见 app.main.lifespan）
    return request.app.state.redis


async def get_http_client(request: Request) -> httpx.AsyncClient:
    # httpx client 在应用生命周期内复用（见 app.main.lifespan）
    return request.app.state.http


async def _enforce_user_batch_rate_limit(request: Request, redis: Redis, user_id: uuid.UUID) -> None:
    if request.method.upper() != "POST":
        return
    path = request.url.path
    if not path.startswith("/api/v1/"):
        return

    if not any(
        path.startswith(prefix)
        for prefix in (
            "/api/v1/domains/",
            "/api/v1/dns/",
            "/api/v1/ssl/",
            "/api/v1/cache/",
            "/api/v1/speed/",
            "/api/v1/rules/",
            "/api/v1/other/",
        )
    ):
        return

    key = f"user:{user_id}:rate_limit"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, int(settings.USER_BATCH_RATE_WINDOW_SECONDS))
    if count > int(settings.USER_BATCH_RATE_LIMIT):
        raise RateLimitedError()


def _extract_access_token(
    request: Request, credentials: HTTPAuthorizationCredentials | None, *, allow_query: bool
) -> tuple[str, str]:
    if credentials and credentials.credentials:
        return credentials.credentials, "bearer"

    cookie_token = str(request.cookies.get("access_token") or "").strip()
    if cookie_token:
        return cookie_token, "cookie"

    if allow_query:
        query_token = str(request.query_params.get("access_token") or request.query_params.get("token") or "").strip()
        if query_token:
            return query_token, "query"

    return "", "none"


async def _get_current_user_impl(
    request: Request,
    *,
    db: AsyncSession,
    credentials: HTTPAuthorizationCredentials | None,
    redis: Redis,
    allow_query: bool,
) -> User:
    token, token_source = _extract_access_token(request, credentials, allow_query=allow_query)
    if not token:
        raise UnauthorizedError("缺少访问令牌")

    if token_source == "cookie":
        require_csrf(request)

    user_id = verify_token(token, token_type="access")
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError as e:
        raise UnauthorizedError("Token 用户ID格式错误") from e

    result = await db.execute(select(User).where(User.id == user_uuid, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if not user:
        raise UnauthorizedError("用户不存在或已被删除")

    changed = False
    changed = (await sync_user_subscription(db, user)) or changed
    changed = (await reset_monthly_credits_if_needed(db, user)) or changed
    if changed:
        await db.commit()

    await _enforce_user_batch_rate_limit(request, redis, user.id)
    return user


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    redis: Redis = Depends(get_redis),
) -> User:
    return await _get_current_user_impl(
        request,
        db=db,
        credentials=credentials,
        redis=redis,
        allow_query=False,
    )


async def get_current_user_header_or_query(
    request: Request,
    db: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    redis: Redis = Depends(get_redis),
) -> User:
    return await _get_current_user_impl(
        request,
        db=db,
        credentials=credentials,
        redis=redis,
        allow_query=bool(settings.ALLOW_QUERY_TOKEN),
    )
