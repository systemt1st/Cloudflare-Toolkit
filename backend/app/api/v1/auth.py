from __future__ import annotations

import re
import uuid
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, EmailStr, Field
from redis.asyncio import Redis
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_http_client, get_redis
from app.config import settings
from app.core.csrf import CSRF_COOKIE_KEY, new_csrf_token, require_csrf
from app.core.exceptions import ConflictError, ForbiddenError, UnauthorizedError, ValidationError
from app.core.security import (
    create_access_token,
    create_password_reset_token,
    create_refresh_token,
    hash_password,
    password_needs_rehash,
    verify_password,
    verify_token,
)
from app.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserPublic
from app.services.resend import send_email

router = APIRouter()

AUTH_STATUS_COOKIE_KEY = "cf_toolkit_authed"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    remember_me: bool = False


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=20)
    remember_me: bool = False


class AuthStatusResponse(BaseModel):
    message: str = "ok"


class ForgotPasswordRequest(BaseModel):
    email: EmailStr
    locale: str = "zh"


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=20)
    password: str = Field(min_length=8, max_length=128)


def _make_nickname(display_name: str | None, email: str) -> str:
    base = (display_name or "").strip()
    if not base:
        base = email.split("@", 1)[0]

    base = base.lower()
    base = re.sub(r"\s+", "", base)
    base = re.sub(r"[^a-z0-9._-]+", "_", base)
    base = base.strip("._-")
    if not base:
        base = "user"
    return base[:50]


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str, remember_me: bool) -> None:
    secure = settings.COOKIE_SECURE if settings.COOKIE_SECURE is not None else settings.ENV != "dev"

    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=secure,
        samesite="strict",
        max_age=60 * settings.ACCESS_TOKEN_EXPIRE_MINUTES,
        path="/",
    )

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=secure,
        samesite="strict",
        max_age=60 * 60 * 24 * settings.REFRESH_TOKEN_EXPIRE_DAYS if remember_me else None,
        path="/",
    )

    response.set_cookie(
        key=AUTH_STATUS_COOKIE_KEY,
        value="1",
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
    )

    response.set_cookie(
        key=CSRF_COOKIE_KEY,
        value=new_csrf_token(),
        httponly=False,
        secure=secure,
        samesite="strict",
        max_age=60 * 60 * 24 * settings.REFRESH_TOKEN_EXPIRE_DAYS,
        path="/",
    )


def _set_access_cookie(response: Response, access_token: str) -> None:
    secure = settings.COOKIE_SECURE if settings.COOKIE_SECURE is not None else settings.ENV != "dev"
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=secure,
        samesite="strict",
        max_age=60 * settings.ACCESS_TOKEN_EXPIRE_MINUTES,
        path="/",
    )


def _set_auth_status_cookie(response: Response) -> None:
    secure = settings.COOKIE_SECURE if settings.COOKIE_SECURE is not None else settings.ENV != "dev"
    response.set_cookie(
        key=AUTH_STATUS_COOKIE_KEY,
        value="1",
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        key=CSRF_COOKIE_KEY,
        value=new_csrf_token(),
        httponly=False,
        secure=secure,
        samesite="strict",
        max_age=60 * 60 * 24 * settings.REFRESH_TOKEN_EXPIRE_DAYS,
        path="/",
    )


@router.post("/register", response_model=UserPublic, status_code=201)
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)) -> UserPublic:
    if re.search(r"[A-Z]", payload.nickname):
        raise ValidationError("昵称不允许包含大写字母")

    email = str(payload.email).lower()
    exists = await db.execute(select(User).where(User.email == email))
    if exists.scalar_one_or_none():
        raise ConflictError("邮箱已被注册")

    user = User(email=email, password_hash=hash_password(payload.password), nickname=payload.nickname)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserPublic(
        id=str(user.id),
        email=user.email,
        nickname=user.nickname,
        subscription_status=user.subscription_status,
        credits=user.credits,
        created_at=user.created_at,
    )


@router.post("/login")
async def login(payload: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)) -> dict:
    result = await db.execute(
        select(User).where(User.email == str(payload.email).lower(), User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()
    if not user or not user.password_hash:
        raise UnauthorizedError("邮箱或密码错误")
    if not verify_password(payload.password, user.password_hash):
        raise UnauthorizedError("邮箱或密码错误")

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(payload.password)
        await db.commit()

    access_token = create_access_token(str(user.id))
    refresh_token = create_refresh_token(str(user.id))
    _set_auth_cookies(response, access_token, refresh_token, payload.remember_me)

    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "nickname": user.nickname,
            "subscription_status": user.subscription_status,
            "credits": user.credits,
        },
    }


@router.post("/google")
async def google_login(
    payload: GoogleLoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> dict:
    if not settings.GOOGLE_CLIENT_ID:
        raise ValidationError("未配置 GOOGLE_CLIENT_ID，无法使用 Google 登录")

    r = await http.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": payload.credential}, timeout=10.0)

    if r.status_code != 200:
        raise UnauthorizedError("Google 登录失败，请重试")

    info = r.json()
    if info.get("aud") != settings.GOOGLE_CLIENT_ID:
        raise UnauthorizedError("Google Token 无效（aud 不匹配）")

    email_verified = str(info.get("email_verified", "")).lower()
    if email_verified not in {"true", "1"}:
        raise UnauthorizedError("Google 邮箱未验证")

    email = str(info.get("email", "")).lower()
    google_id = str(info.get("sub", ""))
    if not email or not google_id:
        raise UnauthorizedError("Google Token 缺少用户信息")

    result = await db.execute(select(User).where(User.google_id == google_id, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()

    if not user:
        result = await db.execute(select(User).where(User.email == email, User.deleted_at.is_(None)))
        user = result.scalar_one_or_none()
        if user:
            if user.google_id and user.google_id != google_id:
                raise ConflictError("该邮箱已绑定其他 Google 账号")
            user.google_id = google_id
        else:
            nickname = _make_nickname(info.get("name"), email)
            user = User(email=email, nickname=nickname, google_id=google_id)
            db.add(user)

    await db.commit()
    await db.refresh(user)

    access_token = create_access_token(str(user.id))
    refresh_token = create_refresh_token(str(user.id))
    _set_auth_cookies(response, access_token, refresh_token, payload.remember_me)

    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "nickname": user.nickname,
            "subscription_status": user.subscription_status,
            "credits": user.credits,
        },
    }


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict:
    if request.cookies.get("access_token") or request.cookies.get("refresh_token"):
        require_csrf(request)
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    response.delete_cookie(AUTH_STATUS_COOKIE_KEY, path="/")
    response.delete_cookie(CSRF_COOKIE_KEY, path="/")
    return {"message": "ok"}


@router.post("/refresh", response_model=AuthStatusResponse)
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> AuthStatusResponse:
    try:
        require_csrf(request)
    except ForbiddenError as e:
        raise UnauthorizedError(e.message) from e

    token = request.cookies.get("refresh_token")
    if not token:
        raise UnauthorizedError("缺少 refresh_token")

    user_id = verify_token(token, token_type="refresh")
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError as e:
        raise UnauthorizedError("Token 用户ID格式错误") from e

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()
    if not user:
        raise UnauthorizedError("用户不存在或已被删除")

    access_token = create_access_token(str(user.id))
    _set_access_cookie(response, access_token)
    _set_auth_status_cookie(response)
    return AuthStatusResponse()


@router.post("/forgot-password")
async def forgot_password(
    payload: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> dict:
    email = str(payload.email).lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        return {"message": "ok"}

    token, jti = create_password_reset_token(str(user.id))
    await redis.set(f"password_reset:{jti}", str(user.id), ex=60 * settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES)

    locale = (payload.locale or "zh").strip().lower() or "zh"
    if locale not in {"zh", "en"}:
        locale = "zh"

    reset_url = (
        f"{settings.FRONTEND_BASE_URL.rstrip('/')}/{locale}/reset-password?token={quote(token, safe='')}"
    )
    subject = "重置密码"
    html = f"""
<p>你好，</p>
<p>你正在重置 CloudFlare批量助手的登录密码，请点击下面链接继续：</p>
<p><a href="{reset_url}">{reset_url}</a></p>
<p>该链接 {settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES} 分钟内有效；如果不是你本人操作，请忽略此邮件。</p>
""".strip()

    if not settings.RESEND_API_KEY and settings.ENV == "dev":
        return {"message": "ok", "reset_url": reset_url}

    await send_email(to=email, subject=subject, html=html)
    return {"message": "ok"}


@router.post("/reset-password")
async def reset_password(
    payload: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> dict:
    try:
        data = jwt.decode(payload.token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as e:
        raise UnauthorizedError("Token 无效") from e

    if data.get("type") != "reset":
        raise UnauthorizedError("Token 类型不匹配")

    user_id = str(data.get("sub") or "").strip()
    jti = str(data.get("jti") or "").strip()
    if not user_id or not jti:
        raise UnauthorizedError("Token 无效")

    key = f"password_reset:{jti}"
    stored_user_id = await redis.get(key)
    if not stored_user_id or stored_user_id != user_id:
        raise UnauthorizedError("重置链接已失效")
    await redis.delete(key)

    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError as e:
        raise UnauthorizedError("Token 用户ID格式错误") from e

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()
    if not user:
        raise UnauthorizedError("用户不存在或已被删除")

    user.password_hash = hash_password(payload.password)
    await db.commit()
    return {"message": "ok"}
