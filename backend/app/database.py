from __future__ import annotations

from collections.abc import AsyncGenerator
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=int(settings.DB_POOL_SIZE),
    max_overflow=int(settings.DB_MAX_OVERFLOW),
    pool_timeout=int(settings.DB_POOL_TIMEOUT),
    pool_recycle=int(settings.DB_POOL_RECYCLE),
)
SessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)

_DEV_MIGRATED = False


def run_dev_migrations() -> None:
    global _DEV_MIGRATED
    if _DEV_MIGRATED:
        return
    if settings.ENV != "dev":
        return

    try:
        from alembic import command  # type: ignore[import-not-found]
        from alembic.config import Config  # type: ignore[import-not-found]
    except Exception:
        return

    base_dir = Path(__file__).resolve().parents[1]
    alembic_ini = base_dir / "alembic.ini"
    if not alembic_ini.exists():
        return

    lock_fp = None
    try:
        import fcntl  # type: ignore

        lock_path = base_dir / ".alembic.lock"
        lock_fp = open(lock_path, "w")
        fcntl.flock(lock_fp.fileno(), fcntl.LOCK_EX)
    except Exception:
        lock_fp = None

    try:
        cfg = Config(str(alembic_ini))
        cfg.set_main_option("script_location", str(base_dir / "alembic"))
        command.upgrade(cfg, "head")
        _DEV_MIGRATED = True
    finally:
        try:
            if lock_fp:
                lock_fp.close()
        except Exception:
            pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
