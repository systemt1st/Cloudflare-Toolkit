from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AppError(Exception):
    code: str
    message: str
    status_code: int = 400
    details: list[dict] | None = None


class ValidationError(AppError):
    def __init__(self, message: str = "请求参数验证失败", details: list[dict] | None = None):
        super().__init__(code="VALIDATION_ERROR", message=message, status_code=400, details=details or [])


class ActivationCodeError(AppError):
    def __init__(self, code: str, message: str, status_code: int = 400):
        super().__init__(code=code, message=message, status_code=status_code, details=[])


class UnauthorizedError(AppError):
    def __init__(self, message: str = "未授权"):
        super().__init__(code="UNAUTHORIZED", message=message, status_code=401, details=[])


class ForbiddenError(AppError):
    def __init__(self, message: str = "禁止访问"):
        super().__init__(code="FORBIDDEN", message=message, status_code=403, details=[])


class NotFoundError(AppError):
    def __init__(self, message: str = "资源不存在"):
        super().__init__(code="NOT_FOUND", message=message, status_code=404, details=[])


class ConflictError(AppError):
    def __init__(self, message: str = "资源冲突"):
        super().__init__(code="CONFLICT", message=message, status_code=409, details=[])


class RateLimitedError(AppError):
    def __init__(self, message: str = "请求过于频繁"):
        super().__init__(code="RATE_LIMITED", message=message, status_code=429, details=[])


class QuotaExceededError(AppError):
    def __init__(self, message: str = "订阅或积分不足"):
        super().__init__(code="QUOTA_EXCEEDED", message=message, status_code=410, details=[])


class InternalError(AppError):
    def __init__(self, message: str = "服务器内部错误"):
        super().__init__(code="INTERNAL_ERROR", message=message, status_code=500, details=[])


class FatalTaskError(AppError):
    def __init__(self, message: str):
        super().__init__(code="FATAL_ERROR", message=message, status_code=400, details=[])
