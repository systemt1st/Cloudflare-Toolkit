from __future__ import annotations

import asyncio
import hashlib
import json
from typing import TYPE_CHECKING, Any

import httpx

from app.core.rate_limiter import RateLimiter, RedisRateLimiter

if TYPE_CHECKING:
    from redis.asyncio import Redis
else:  # pragma: no cover
    Redis = Any  # type: ignore[misc,assignment]


class CloudflareAPIError(Exception):
    def __init__(
        self,
        errors: list[dict] | None = None,
        *,
        status_code: int | None = None,
        method: str | None = None,
        path: str | None = None,
        cf_ray: str | None = None,
        request_id: str | None = None,
    ):
        self.errors = errors or []
        self.status_code = status_code
        self.method = method
        self.path = path
        self.cf_ray = cf_ray
        self.request_id = request_id
        super().__init__(self._format_message())

    def _format_message(self) -> str:
        if not self.errors:
            base = "Cloudflare API 请求失败"
        else:
            first = self.errors[0]
            code = first.get("code")
            message = first.get("message")
            base = f"Cloudflare API 错误: {code} {message}".strip()

        extras: list[str] = []
        if self.method and self.path:
            extras.append(f"{self.method} {self.path}")
        if self.cf_ray:
            extras.append(f"cf-ray={self.cf_ray}")
        if self.request_id:
            extras.append(f"request_id={self.request_id}")
        if extras:
            return f"{base} ({', '.join(extras)})"
        return base


def _fingerprint_credentials(credential_type: str, credentials: dict) -> str:
    try:
        raw = json.dumps(credentials, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except TypeError:
        raw = str(credentials)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return f"{credential_type}:{digest}"


_RATE_LIMITERS: dict[str, RateLimiter] = {}


class CloudflareClient:
    BASE_URL = "https://api.cloudflare.com/client/v4"
    USER_AGENT = "CF-Toolkit/0.1.0"

    def __init__(
        self,
        credential_type: str,
        credentials: dict,
        http_client: httpx.AsyncClient | None = None,
        redis: Redis | None = None,
    ):
        self.credential_type = credential_type
        self.credentials = credentials
        limiter_key = _fingerprint_credentials(credential_type, credentials)
        self.rate_limiter = _RATE_LIMITERS.setdefault(limiter_key, RateLimiter(rate=4, per=1))
        self._redis_limiter = RedisRateLimiter(redis, f"cf:rate:{limiter_key}", rate=4, per=1) if redis else None
        self._http = http_client

    def _get_auth_headers(self) -> dict[str, str]:
        if self.credential_type == "api_token":
            return {"Authorization": f"Bearer {self.credentials['api_token']}"}
        return {"X-Auth-Email": self.credentials["email"], "X-Auth-Key": self.credentials["api_key"]}

    async def _request_with_client(self, client: httpx.AsyncClient, method: str, path: str, **kwargs) -> dict[str, Any]:
        headers = self._get_auth_headers()
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "application/json"
        headers.setdefault("User-Agent", self.USER_AGENT)

        for attempt in range(3):
            try:
                response = await client.request(method, f"{self.BASE_URL}{path}", headers=headers, **kwargs)
            except httpx.TimeoutException:
                if attempt >= 2:
                    raise
                await asyncio.sleep(1)
                continue
            except httpx.RequestError as e:
                if attempt >= 2:
                    raise CloudflareAPIError(
                        [{"code": "REQUEST_ERROR", "message": str(e)}],
                        status_code=None,
                        method=method,
                        path=path,
                    ) from e
                await asyncio.sleep(1)
                continue

            cf_ray = response.headers.get("cf-ray")
            request_id = response.headers.get("x-request-id") or response.headers.get("cf-request-id")

            if response.status_code == 429:
                wait_seconds = 2**attempt
                retry_after = response.headers.get("Retry-After")
                if retry_after:
                    try:
                        wait_seconds = max(wait_seconds, int(retry_after))
                    except ValueError:
                        pass
                await asyncio.sleep(wait_seconds)
                continue

            if response.status_code >= 500:
                if attempt >= 2:
                    raise CloudflareAPIError(
                        [{"code": response.status_code, "message": response.text}],
                        status_code=response.status_code,
                        method=method,
                        path=path,
                        cf_ray=cf_ray,
                        request_id=request_id,
                    )
                await asyncio.sleep(2**attempt)
                continue

            try:
                data = response.json()
            except ValueError as e:
                raise CloudflareAPIError(
                    [{"code": response.status_code, "message": response.text}],
                    status_code=response.status_code,
                    method=method,
                    path=path,
                    cf_ray=cf_ray,
                    request_id=request_id,
                ) from e

            if not data.get("success", False):
                raise CloudflareAPIError(
                    data.get("errors", []),
                    status_code=response.status_code,
                    method=method,
                    path=path,
                    cf_ray=cf_ray,
                    request_id=request_id,
                )
            return data

        raise CloudflareAPIError([], status_code=None)

    async def request(self, method: str, path: str, **kwargs) -> dict[str, Any]:
        if self._redis_limiter:
            try:
                await self._redis_limiter.acquire()
            except Exception:  # noqa: BLE001
                await self.rate_limiter.acquire()
        else:
            await self.rate_limiter.acquire()

        if self._http:
            return await self._request_with_client(self._http, method, path, **kwargs)
        async with httpx.AsyncClient(timeout=30.0) as client:
            return await self._request_with_client(client, method, path, **kwargs)

    async def verify_token(self) -> dict[str, Any]:
        # Cloudflare 提供 Token 校验接口；Global Key 场景也可调用 /user 作为验证
        if self.credential_type == "api_token":
            return await self.request("GET", "/user/tokens/verify")
        return await self.request("GET", "/user")

    async def list_zones(self, page: int = 1, per_page: int = 50) -> dict[str, Any]:
        return await self.request("GET", f"/zones?page={page}&per_page={per_page}")

    async def create_zone(self, name: str, jump_start: bool = True) -> dict[str, Any]:
        return await self.request("POST", "/zones", json={"name": name, "jump_start": jump_start})

    async def delete_zone(self, zone_id: str) -> dict[str, Any]:
        return await self.request("DELETE", f"/zones/{zone_id}")

    async def list_all_zones(self, per_page: int = 50) -> list[dict[str, Any]]:
        zones: list[dict[str, Any]] = []
        page = 1
        while True:
            data = await self.list_zones(page=page, per_page=per_page)
            result = data.get("result", []) or []
            zones.extend(result)

            info = data.get("result_info") or {}
            total_pages = info.get("total_pages")
            if total_pages:
                if page >= int(total_pages):
                    break
            else:
                if len(result) < per_page:
                    break

            page += 1
        return zones

    async def create_dns_record(self, zone_id: str, record: dict[str, Any]) -> dict[str, Any]:
        return await self.request("POST", f"/zones/{zone_id}/dns_records", json=record)

    async def list_dns_records(self, zone_id: str, **params: Any) -> dict[str, Any]:
        return await self.request("GET", f"/zones/{zone_id}/dns_records", params=params)

    async def update_dns_record(self, zone_id: str, record_id: str, record: dict[str, Any]) -> dict[str, Any]:
        return await self.request("PUT", f"/zones/{zone_id}/dns_records/{record_id}", json=record)

    async def delete_dns_record(self, zone_id: str, record_id: str) -> dict[str, Any]:
        return await self.request("DELETE", f"/zones/{zone_id}/dns_records/{record_id}")

    async def update_zone_setting(self, zone_id: str, setting: str, value: Any) -> dict[str, Any]:
        return await self.request("PATCH", f"/zones/{zone_id}/settings/{setting}", json={"value": value})

    async def purge_cache(self, zone_id: str, purge_everything: bool = True, files: list[str] | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"purge_everything": bool(purge_everything)}
        if files:
            payload = {"files": files}
        return await self.request("POST", f"/zones/{zone_id}/purge_cache", json=payload)

    async def list_page_rules(self, zone_id: str) -> dict[str, Any]:
        return await self.request("GET", f"/zones/{zone_id}/pagerules")

    async def create_page_rule(self, zone_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.request("POST", f"/zones/{zone_id}/pagerules", json=payload)

    async def delete_page_rule(self, zone_id: str, rule_id: str) -> dict[str, Any]:
        return await self.request("DELETE", f"/zones/{zone_id}/pagerules/{rule_id}")

    async def get_ruleset_entrypoint(self, zone_id: str, phase: str) -> dict[str, Any]:
        return await self.request("GET", f"/zones/{zone_id}/rulesets/phases/{phase}/entrypoint")

    async def update_ruleset_entrypoint(self, zone_id: str, phase: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.request("PUT", f"/zones/{zone_id}/rulesets/phases/{phase}/entrypoint", json=payload)
