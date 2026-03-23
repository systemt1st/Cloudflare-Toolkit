from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.responses import HTMLResponse
from redis.asyncio import Redis
from sqlalchemy.exc import ProgrammingError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.router import api_router
from app.config import settings
from app.core.exceptions import AppError
from app.database import run_dev_migrations

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_dev_migrations()
    app.state.redis = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        app.state.http = httpx.AsyncClient(
            http2=True,
            timeout=httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0),
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20, keepalive_expiry=60.0),
            headers={"User-Agent": "CF-Toolkit/0.1.0"},
        )
    except ImportError:
        logger.warning("未安装 httpx[http2]/h2，已降级为 HTTP/1.1")
        app.state.http = httpx.AsyncClient(
            http2=False,
            timeout=httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0),
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20, keepalive_expiry=60.0),
            headers={"User-Agent": "CF-Toolkit/0.1.0"},
        )
    try:
        yield
    finally:
        await app.state.http.aclose()
        await app.state.redis.aclose()


def create_app() -> FastAPI:
    app = FastAPI(title="CloudFlare批量助手 API", version="0.1.0", lifespan=lifespan)

    env = str(settings.ENV or "").strip().lower() or "prod"
    origins = [str(o) for o in settings.CORS_ORIGINS] if settings.CORS_ORIGINS else []
    allow_origin_regex: str | None = None
    if env == "dev":
        if not origins:
            origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
        allow_origin_regex = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

    cors_options: dict[str, object] = {
        "allow_origins": origins,
        "allow_credentials": True,
        "allow_methods": ["*"],
        "allow_headers": ["*"],
    }
    if allow_origin_regex is not None:
        cors_options["allow_origin_regex"] = allow_origin_regex

    app.add_middleware(CORSMiddleware, **cors_options)

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"status": "ok"}

    @app.get("/", response_class=HTMLResponse)
    async def root() -> str:
        return """
        <html>
            <head>
                <title>CloudFlare批量助手 API</title>
            </head>
            <body>
                <h1>CloudFlare批量助手 API 服务</h1>
                <p>后端服务运行正常。</p>
                <ul>
                    <li><strong>API 文档:</strong> <a href="/docs">/docs</a> (Swagger UI)</li>
                    <li><strong>API 规范:</strong> <a href="/redoc">/redoc</a></li>
                    <li><strong>健康检查:</strong> <a href="/healthz">/healthz</a></li>
                </ul>
                <hr/>
                <p>项目地址: <a href="https://github.com/systemt1st/Cloudflare-Toolkit" target="_blank">Cloudflare-Toolkit</a></p>
            </body>
        </html>
        """

    app.include_router(api_router, prefix="/api/v1")

    if settings.METRICS_ENABLED:
        try:
            from prometheus_fastapi_instrumentator import Instrumentator  # type: ignore

            Instrumentator().instrument(app).expose(app, endpoint="/api/metrics", include_in_schema=False)
        except Exception:  # noqa: BLE001
            pass

    @app.exception_handler(AppError)
    async def app_error_handler(_request, exc: AppError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request, exc: RequestValidationError):
        details = []
        for err in exc.errors():
            loc = [str(x) for x in err.get("loc", []) if x != "body"]
            details.append({"field": ".".join(loc) or "body", "message": err.get("msg", "Invalid")})
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "VALIDATION_ERROR", "message": "请求参数验证失败", "details": details}},
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(_request, exc: StarletteHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": "HTTP_ERROR", "message": str(exc.detail), "details": []}},
        )

    @app.exception_handler(ConnectionRefusedError)
    async def connection_refused_handler(_request, exc: ConnectionRefusedError):
        logger.exception("Upstream dependency connection refused")
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "code": "SERVICE_UNAVAILABLE",
                    "message": "依赖服务连接失败，请确认数据库/Redis 已启动",
                    "details": [],
                }
            },
        )

    @app.exception_handler(OSError)
    async def os_error_handler(_request, exc: OSError):
        message = str(exc).lower()
        if "connect call failed" in message or "connection refused" in message or "errno 61" in message or "errno 111" in message:
            logger.exception("Upstream dependency connection failed")
            return JSONResponse(
                status_code=503,
                content={
                    "error": {
                        "code": "SERVICE_UNAVAILABLE",
                        "message": "依赖服务连接失败，请确认数据库/Redis 已启动",
                        "details": [],
                    }
                },
            )

        logger.exception("Unhandled OS error")
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "INTERNAL_ERROR", "message": "服务器内部错误", "details": []}},
        )

    @app.exception_handler(ProgrammingError)
    async def sqlalchemy_programming_error_handler(_request, exc: ProgrammingError):
        orig = getattr(exc, "orig", None)
        orig_name = getattr(getattr(orig, "__class__", None), "__name__", "") if orig else ""
        lowered = str(exc).lower()

        if orig_name in {"UndefinedColumnError", "UndefinedTableError"} or (
            "does not exist" in lowered and ("column" in lowered or "relation" in lowered)
        ):
            logger.exception("Database schema mismatch")
            return JSONResponse(
                status_code=500,
                content={
                    "error": {
                        "code": "DB_SCHEMA_OUTDATED",
                        "message": "数据库结构未迁移或不匹配，请执行 alembic upgrade head（开发环境可重启后端自动迁移）",
                        "details": [],
                    }
                },
            )

        logger.exception("Database programming error")
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "DB_ERROR", "message": "数据库执行错误", "details": []}},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_request, exc: Exception):
        logger.exception("Unhandled server error")
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "INTERNAL_ERROR", "message": "服务器内部错误", "details": []}},
        )

    return app


app = create_app()
