from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Any


class RateLimiter:
    """令牌桶限流器（仅进程内，后续可替换为 Redis 分布式）。"""

    def __init__(self, rate: int, per: float):
        self.rate = rate
        self.per = per
        self.tokens = float(rate)
        self.last_update = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self.last_update
            refill = elapsed * (self.rate / self.per)
            self.tokens = min(float(self.rate), self.tokens + refill)
            self.last_update = now

            if self.tokens < 1:
                wait_time = (1 - self.tokens) * (self.per / self.rate)
                await asyncio.sleep(wait_time)
                self.last_update = time.monotonic()
                self.tokens = 0.0
                return

            self.tokens -= 1


if TYPE_CHECKING:
    from redis.asyncio import Redis
else:  # pragma: no cover
    Redis = Any  # type: ignore[misc,assignment]


_REDIS_TOKEN_BUCKET_LUA = r"""
local rate = tonumber(ARGV[1])
local per_ms = tonumber(ARGV[2])

local t = redis.call('TIME')
local now_ms = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local tokens = tonumber(redis.call('HGET', KEYS[1], 't'))
if tokens == nil then tokens = rate end
local last_ms = tonumber(redis.call('HGET', KEYS[1], 'ts'))
if last_ms == nil then last_ms = now_ms end

local elapsed = now_ms - last_ms
if elapsed < 0 then elapsed = 0 end

tokens = math.min(rate, tokens + elapsed * (rate / per_ms))

local wait_ms = 0
if tokens < 1 then
  wait_ms = math.ceil((1 - tokens) * (per_ms / rate))
else
  tokens = tokens - 1
end

redis.call('HSET', KEYS[1], 't', tokens, 'ts', now_ms)
redis.call('PEXPIRE', KEYS[1], per_ms * 2)
return wait_ms
"""


class RedisRateLimiter:
    """Redis 分布式令牌桶（按 key 共享）。"""

    def __init__(self, redis: Redis, key: str, *, rate: int, per: float):
        self.redis = redis
        self.key = key
        self.rate = int(rate)
        self.per = float(per)

    async def acquire(self) -> None:
        per_ms = max(1, int(self.per * 1000))
        wait_ms = await self.redis.eval(_REDIS_TOKEN_BUCKET_LUA, 1, self.key, self.rate, per_ms)
        try:
            wait_ms_int = int(wait_ms or 0)
        except Exception:  # noqa: BLE001
            wait_ms_int = 0
        if wait_ms_int > 0:
            await asyncio.sleep(wait_ms_int / 1000.0)
