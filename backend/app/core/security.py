from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings
from app.core.exceptions import UnauthorizedError

pwd_context = CryptContext(schemes=["argon2", "pbkdf2_sha256"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def password_needs_rehash(password_hash: str) -> bool:
    return pwd_context.needs_update(password_hash)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user_id: str) -> str:
    expire = _utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": user_id, "exp": expire, "type": "access"}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    expire = _utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {"sub": user_id, "exp": expire, "type": "refresh"}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_password_reset_token(user_id: str) -> tuple[str, str]:
    jti = uuid.uuid4().hex
    expire = _utcnow() + timedelta(minutes=settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": user_id, "exp": expire, "type": "reset", "jti": jti}
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return token, jti


def verify_token(token: str, token_type: str = "access") -> str:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as e:
        raise UnauthorizedError("Token 无效") from e
    if payload.get("type") != token_type:
        raise UnauthorizedError("Token 类型不匹配")
    user_id = payload.get("sub")
    if not user_id:
        raise UnauthorizedError("Token 缺少用户信息")
    return str(user_id)
