from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import accounts, auth, cache, dns, domains, operation_logs, other, payments, rules, speed, ssl, subscriptions, tasks, users

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(accounts.router, prefix="/accounts", tags=["accounts"])
api_router.include_router(domains.router, prefix="/domains", tags=["domains"])
api_router.include_router(dns.router, prefix="/dns", tags=["dns"])
api_router.include_router(ssl.router, prefix="/ssl", tags=["ssl"])
api_router.include_router(cache.router, prefix="/cache", tags=["cache"])
api_router.include_router(speed.router, prefix="/speed", tags=["speed"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
api_router.include_router(subscriptions.router, prefix="/subscriptions", tags=["subscriptions"])
api_router.include_router(payments.router, prefix="/payments", tags=["payments"])
api_router.include_router(operation_logs.router, prefix="/operation-logs", tags=["operation_logs"])
api_router.include_router(rules.router, prefix="/rules", tags=["rules"])
api_router.include_router(other.router, prefix="/other", tags=["other"])
