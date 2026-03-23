from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AnyUrl
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_BACKEND_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    # 固定从后端项目根目录读取 .env，避免从仓库根目录启动时误读到外层 .env
    model_config = SettingsConfigDict(env_file=str(_BACKEND_ROOT / ".env"), env_file_encoding="utf-8", extra="ignore")

    # ===================
    # 基础配置
    # ===================
    # 默认按生产环境处理，避免误用 dev 配置上线
    ENV: str = "prod"

    # ===================
    # 第三方登录
    # ===================
    GOOGLE_CLIENT_ID: str = ""

    # ===================
    # 邮件服务（Resend）
    # ===================
    RESEND_API_KEY: str = ""
    # Resend 默认可用的测试发件人（生产请改为你验证过的域名发件人）
    RESEND_FROM: str = "onboarding@resend.dev"
    # 用于拼接重置密码链接
    FRONTEND_BASE_URL: str = "http://localhost:3000"

    # ===================
    # 数据库 / Redis
    # ===================
    DATABASE_URL: str = "postgresql+asyncpg://dev:dev123@localhost:5432/cf_toolkit_dev"
    REDIS_URL: str = "redis://localhost:6379/0"
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 1800

    # ===================
    # 安全配置
    # ===================
    JWT_SECRET: str = "change_me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    PASSWORD_RESET_TOKEN_EXPIRE_MINUTES: int = 30

    # Fernet.generate_key().decode()
    ENCRYPTION_KEY: str = "change_me"

    # Cookie 安全选项（默认：dev 不启用 secure，其它环境启用；可用该配置覆盖）
    COOKIE_SECURE: bool | None = None
    # 是否允许通过 query string 传 access_token（默认禁用，避免被日志/代理记录泄漏）
    ALLOW_QUERY_TOKEN: bool = False

    # ===================
    # CORS
    # ===================
    CORS_ORIGINS: list[AnyUrl] = []

    # ===================
    # 监控
    # ===================
    METRICS_ENABLED: bool = True

    # ===================
    # 订阅/积分/限流
    # ===================
    FREE_MONTHLY_CREDITS: int = 1000
    CREDITS_PER_ITEM: int = 10
    USER_BATCH_RATE_LIMIT: int = 10
    USER_BATCH_RATE_WINDOW_SECONDS: int = 60

    # ===================
    # 支付（BEpusdt）
    # ===================
    BEPUSDT_BASE_URL: str = "http://localhost:8080"
    BEPUSDT_AUTH_TOKEN: str = ""
    BEPUSDT_DEFAULT_TRADE_TYPE: str = "usdt.trc20"
    BEPUSDT_ORDER_TIMEOUT_SECONDS: int = 1200
    BEPUSDT_PRICE_YEARLY_CNY_CENTS: int = 9999
    BEPUSDT_NOTIFY_URL: str = ""

    # ===================
    # 支付（Stripe）
    # ===================
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PRICE_ID_YEARLY: str = ""
    STRIPE_ALLOW_PROMO_CODES: bool = False

    @model_validator(mode="after")
    def _validate_security_in_non_dev(self) -> "Settings":
        env = str(self.ENV or "").strip().lower() or "prod"
        if env == "dev":
            return self

        if not self.JWT_SECRET or self.JWT_SECRET == "change_me" or len(self.JWT_SECRET) < 16:
            raise ValueError("生产环境必须配置强 JWT_SECRET（建议 >= 16 字符，且不允许为 change_me）")

        if not self.ENCRYPTION_KEY or self.ENCRYPTION_KEY == "change_me":
            raise ValueError("生产环境必须配置有效 ENCRYPTION_KEY（Fernet Key）")

        try:
            from cryptography.fernet import Fernet

            Fernet(self.ENCRYPTION_KEY.encode())
        except Exception as e:  # noqa: BLE001
            raise ValueError("生产环境 ENCRYPTION_KEY 无效（必须为 Fernet.generate_key().decode() 输出）") from e

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
