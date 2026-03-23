from __future__ import annotations

import secrets

from fastapi import Request

from app.core.exceptions import ForbiddenError

CSRF_COOKIE_KEY = "csrf_token"
CSRF_HEADER_KEY = "X-CSRF-Token"

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def require_csrf(request: Request) -> None:
    if request.method.upper() in _SAFE_METHODS:
        return

    csrf_cookie = str(request.cookies.get(CSRF_COOKIE_KEY) or "").strip()
    csrf_header = str(request.headers.get(CSRF_HEADER_KEY) or "").strip()
    if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
        raise ForbiddenError("CSRF 校验失败")
