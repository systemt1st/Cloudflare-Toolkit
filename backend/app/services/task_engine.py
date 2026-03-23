from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from redis.asyncio import Redis
else:  # pragma: no cover
    Redis = Any  # type: ignore[misc,assignment]

from app.core.exceptions import FatalTaskError

MAX_TASK_EVENTS = 5000
TASK_TTL_SECONDS = 86400


BeforeItemHook = Callable[[dict[str, Any]], Awaitable[None]]
AfterItemHook = Callable[[dict[str, Any], str, str, dict | None, bool], Awaitable[None]]


class TaskEngine:
    def __init__(self, redis: Redis):
        self.redis = redis

    def _new_pipeline(self):
        pipeline_fn = getattr(self.redis, "pipeline", None)
        if not callable(pipeline_fn):
            return None
        try:
            return pipeline_fn(transaction=False)
        except TypeError:
            return pipeline_fn()
        except Exception:  # noqa: BLE001
            return None

    async def create_task(
        self,
        task_type: str,
        items: list[dict],
        metadata: dict | None = None,
        user_id: str | None = None,
    ) -> str:
        task_id = str(uuid.uuid4())
        metadata = metadata or {}
        created_at = datetime.now(timezone.utc)

        mapping: dict[str, object] = {
            "status": "pending",
            "type": task_type,
            "total": len(items),
            "current": 0,
            "success": 0,
            "failed": 0,
            "metadata": json.dumps(metadata, ensure_ascii=False),
            "created_at": created_at.isoformat(),
            # task:{id}:events 为 list，SSE 使用自增 cursor；为避免 list 截断后 cursor 失效，记录 offset/seq
            "event_offset": 0,
            "event_seq": -1,
        }
        if user_id:
            mapping["user_id"] = user_id

        task_key = f"task:{task_id}"
        pipe = self._new_pipeline()
        if pipe:
            pipe.hset(task_key, mapping=mapping)
            pipe.expire(task_key, TASK_TTL_SECONDS)
            await pipe.execute()
        else:
            await self.redis.hset(task_key, mapping=mapping)
            await self.redis.expire(task_key, TASK_TTL_SECONDS)
        if user_id:
            user_tasks_key = f"user:{user_id}:tasks"
            try:
                await self.redis.zadd(user_tasks_key, {task_id: created_at.timestamp()})
                await self.redis.expire(user_tasks_key, TASK_TTL_SECONDS)
                total = int(await self.redis.zcard(user_tasks_key) or 0)
                max_keep = 500
                if total > max_keep:
                    await self.redis.zremrangebyrank(user_tasks_key, 0, total - max_keep - 1)
            except Exception:  # noqa: BLE001
                pass

        items_key = f"task:{task_id}:items"
        batch: list[str] = []
        for item in items:
            batch.append(json.dumps(item, ensure_ascii=False))
            if len(batch) >= 500:
                await self.redis.rpush(items_key, *batch)
                batch.clear()
        if batch:
            await self.redis.rpush(items_key, *batch)
        await self.redis.expire(items_key, TASK_TTL_SECONDS)

        return task_id

    async def start_background_execution(
        self,
        task_id: str,
        executor: Callable[[dict], Awaitable[dict]],
        before_item: BeforeItemHook | None = None,
        after_item: AfterItemHook | None = None,
        on_finish: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        asyncio.create_task(
            self._execute_safe(task_id, executor, before_item=before_item, after_item=after_item, on_finish=on_finish)
        )

    async def _execute_safe(
        self,
        task_id: str,
        executor: Callable[[dict], Awaitable[dict]],
        *,
        before_item: BeforeItemHook | None,
        after_item: AfterItemHook | None,
        on_finish: Callable[[], Awaitable[None]] | None,
    ) -> None:
        try:
            try:
                await self._execute(task_id, executor, before_item=before_item, after_item=after_item)
            except Exception as e:  # noqa: BLE001
                task_key = f"task:{task_id}"
                finished_at = datetime.now(timezone.utc)
                message = f"任务执行异常: {e}"

                try:
                    total = int(await self.redis.hget(task_key, "total") or 0)
                    current = int(await self.redis.hget(task_key, "current") or 0)
                    success = int(await self.redis.hget(task_key, "success") or 0)
                    failed = int(await self.redis.hget(task_key, "failed") or 0)
                except Exception:  # noqa: BLE001
                    total = 0
                    current = 0
                    success = 0
                    failed = 0

                cancelled = max(0, total - success - failed)
                try:
                    await self.redis.hset(
                        task_key,
                        mapping={
                            "status": "cancelled",
                            "finished_at": finished_at.isoformat(),
                            "fatal_error": str(e),
                        },
                    )
                    await self._push_event(
                        task_id,
                        event="progress",
                        data={"current": current, "total": total, "status": "error", "message": message, "fatal": True},
                    )
                    await self._push_event(
                        task_id,
                        event="complete",
                        data={
                            "success": success,
                            "failed": failed,
                            "cancelled": cancelled,
                            "total": total,
                            "status": "cancelled",
                        },
                    )
                except Exception:  # noqa: BLE001
                    return
        finally:
            if on_finish:
                try:
                    await on_finish()
                except Exception:  # noqa: BLE001
                    pass

    def _build_result_row(
        self,
        item: dict,
        status: str,
        message: str,
        result: object | None = None,
        fatal: bool | None = None,
    ) -> dict:
        detail: dict[str, object] = {"item": item}
        if result is not None:
            detail["result"] = result
        if fatal is not None:
            detail["fatal"] = fatal

        domain = item.get("domain")
        return {
            "domain": domain if domain is not None else "",
            "status": status,
            "message": message,
            "detail": json.dumps(detail, ensure_ascii=False, default=str),
        }

    async def _push_result(self, task_id: str, row: dict) -> None:
        key = f"task:{task_id}:results"
        payload = json.dumps(row, ensure_ascii=False)
        pipe = self._new_pipeline()
        if pipe:
            pipe.rpush(key, payload)
            pipe.expire(key, TASK_TTL_SECONDS)
            await pipe.execute()
            return
        await self.redis.rpush(key, payload)
        await self.redis.expire(key, TASK_TTL_SECONDS)

    async def _drain_cancelled_items(self, task_id: str, total: int) -> int:
        cancelled = 0
        while True:
            item_data = await self.redis.lpop(f"task:{task_id}:items")
            if not item_data:
                break
            item = json.loads(item_data)
            cancelled += 1
            await self._push_result(
                task_id,
                self._build_result_row(item=item, status="cancelled", message="已取消"),
            )

        await self.redis.hset(f"task:{task_id}", mapping={"cancelled": cancelled, "total": total})
        return cancelled

    async def _execute(
        self,
        task_id: str,
        executor: Callable[[dict], Awaitable[dict]],
        *,
        before_item: BeforeItemHook | None,
        after_item: AfterItemHook | None,
    ) -> None:
        total = int(await self.redis.hget(f"task:{task_id}", "total") or 0)

        status = await self.redis.hget(f"task:{task_id}", "status")
        if status in {"cancelled", "cancelling"}:
            await self.redis.hset(
                f"task:{task_id}",
                mapping={"status": "cancelled", "finished_at": datetime.now(timezone.utc).isoformat()},
            )
            cancelled = await self._drain_cancelled_items(task_id, total)
            await self._push_event(
                task_id,
                event="complete",
                data={"success": 0, "failed": 0, "cancelled": cancelled, "total": total, "status": "cancelled"},
            )
            return

        started_at = datetime.now(timezone.utc)
        await self.redis.hset(
            f"task:{task_id}",
            mapping={"status": "running", "started_at": started_at.isoformat()},
        )
        current = 0
        success_count = 0
        failed_count = 0

        while True:
            status = await self.redis.hget(f"task:{task_id}", "status")
            if status in {"cancelling", "cancelled"}:
                await self.redis.hset(f"task:{task_id}", mapping={"status": "cancelled"})
                break

            item_data = await self.redis.lpop(f"task:{task_id}:items")
            if not item_data:
                break
            item = json.loads(item_data)
            current += 1

            try:
                if before_item:
                    await before_item(item)

                result = await executor(item)
                success_count += 1
                reserved = {"current", "total", "domain", "status", "message"}
                extra = (
                    {k: v for k, v in result.items() if k not in reserved} if isinstance(result, dict) else {}
                )
                message = (result or {}).get("message", "Success") if isinstance(result, dict) else "Success"
                await self._push_event(
                    task_id,
                    event="progress",
                    data={
                        "current": current,
                        "total": total,
                        "domain": item.get("domain"),
                        "status": "success",
                        "message": message,
                        **extra,
                    },
                    task_mapping={"current": current, "success": success_count, "failed": failed_count},
                    result_row=self._build_result_row(item=item, status="success", message=message, result=result),
                )
                if after_item:
                    try:
                        await after_item(item, "success", message, result, False)
                    except Exception:  # noqa: BLE001
                        pass
            except FatalTaskError as e:
                failed_count += 1
                await self.redis.hset(f"task:{task_id}", mapping={"status": "cancelled"})
                await self._push_event(
                    task_id,
                    event="progress",
                    data={
                        "current": current,
                        "total": total,
                        "domain": item.get("domain"),
                        "status": "error",
                        "message": e.message,
                        "fatal": True,
                    },
                    task_mapping={"current": current, "success": success_count, "failed": failed_count},
                    result_row=self._build_result_row(item=item, status="error", message=e.message, result=None, fatal=True),
                )
                if after_item:
                    try:
                        await after_item(item, "error", e.message, None, True)
                    except Exception:  # noqa: BLE001
                        pass
                break
            except Exception as e:  # noqa: BLE001
                failed_count += 1
                message = str(e)
                await self._push_event(
                    task_id,
                    event="progress",
                    data={
                        "current": current,
                        "total": total,
                        "domain": item.get("domain"),
                        "status": "error",
                        "message": message,
                    },
                    task_mapping={"current": current, "success": success_count, "failed": failed_count},
                    result_row=self._build_result_row(item=item, status="error", message=message, result=None),
                )
                if after_item:
                    try:
                        await after_item(item, "error", message, None, False)
                    except Exception:  # noqa: BLE001
                        pass

        status = await self.redis.hget(f"task:{task_id}", "status")
        cancelled = 0
        if status == "cancelled":
            cancelled = await self._drain_cancelled_items(task_id, total)
        else:
            await self.redis.hset(f"task:{task_id}", mapping={"status": "completed"})
            status = "completed"

        finished_at = datetime.now(timezone.utc)
        duration = (finished_at - started_at).total_seconds()
        await self.redis.hset(
            f"task:{task_id}",
            mapping={
                "finished_at": finished_at.isoformat(),
                "duration": duration,
                "cancelled": cancelled,
            },
        )

        await self._push_event(
            task_id,
            event="complete",
            data={
                "success": success_count,
                "failed": failed_count,
                "cancelled": cancelled,
                "total": total,
                "duration": duration,
                "status": status,
            },
        )

    async def _push_event(
        self,
        task_id: str,
        event: str,
        data: dict,
        *,
        task_mapping: dict[str, object] | None = None,
        result_row: dict | None = None,
    ) -> None:
        task_key = f"task:{task_id}"
        events_key = f"task:{task_id}:events"
        payload = json.dumps({"event": event, "data": data}, ensure_ascii=False)

        # 分配一个全局递增的 cursor（与 list 截断无关）
        pipe = self._new_pipeline()
        length = 0
        if pipe:
            if task_mapping:
                pipe.hset(task_key, mapping=task_mapping)
            pipe.hincrby(task_key, "event_seq", 1)
            pipe.rpush(events_key, payload)
            pipe.expire(events_key, TASK_TTL_SECONDS)
            if result_row is not None:
                results_key = f"task:{task_id}:results"
                pipe.rpush(results_key, json.dumps(result_row, ensure_ascii=False))
                pipe.expire(results_key, TASK_TTL_SECONDS)
            pipe.llen(events_key)
            results = await pipe.execute()
            length = int(results[-1] or 0)
        else:
            if task_mapping:
                try:
                    await self.redis.hset(task_key, mapping=task_mapping)
                except Exception:  # noqa: BLE001
                    pass
            try:
                await self.redis.hincrby(task_key, "event_seq", 1)
            except Exception:  # noqa: BLE001
                pass

            await self.redis.rpush(events_key, payload)
            await self.redis.expire(events_key, TASK_TTL_SECONDS)
            if result_row is not None:
                await self._push_result(task_id, result_row)
            try:
                length = int(await self.redis.llen(events_key) or 0)
            except Exception:  # noqa: BLE001
                length = 0

        # 控制事件数量，避免 Redis 内存被无限增长占满
        try:
            if length > MAX_TASK_EVENTS:
                removed = length - MAX_TASK_EVENTS
                trim_pipe = self._new_pipeline()
                if trim_pipe:
                    trim_pipe.ltrim(events_key, removed, -1)
                    trim_pipe.hincrby(task_key, "event_offset", removed)
                    await trim_pipe.execute()
                else:
                    await self.redis.ltrim(events_key, removed, -1)
                    await self.redis.hincrby(task_key, "event_offset", removed)
        except Exception:  # noqa: BLE001
            pass

    async def stream_task(self, task_id: str, start: int = 0) -> AsyncGenerator[dict, None]:
        loop = asyncio.get_running_loop()
        heartbeat_at = 0.0
        cursor = max(0, int(start or 0))
        idle_sleep = 0.2
        task_key = f"task:{task_id}"
        events_key = f"task:{task_id}:events"

        while True:
            now = loop.time()
            if now - heartbeat_at >= 10:
                heartbeat_at = now
                yield {"event": "heartbeat", "data": json.dumps({"timestamp": datetime.now(timezone.utc).isoformat()})}

            raw_offset = await self.redis.hget(task_key, "event_offset")
            try:
                offset = max(0, int(raw_offset or 0))
            except ValueError:
                offset = 0
            if cursor < offset:
                cursor = offset

            # 批量读取，降低 Redis QPS（历史回放/断线续传更明显）
            start_idx = max(0, cursor - offset)
            batch = await self.redis.lrange(events_key, start_idx, start_idx + 200 - 1)
            if batch:
                idle_sleep = 0.2
                for raw in batch:
                    obj = json.loads(raw)
                    yield {
                        "id": str(cursor),
                        "event": obj.get("event", "message"),
                        "data": json.dumps(obj.get("data", {}), ensure_ascii=False),
                    }
                    cursor += 1
                    if obj.get("event") == "complete":
                        return
                continue

            status = await self.redis.hget(f"task:{task_id}", "status")
            if status in {"completed", "cancelled"}:
                total = int(await self.redis.hget(f"task:{task_id}", "total") or 0)
                success = int(await self.redis.hget(f"task:{task_id}", "success") or 0)
                failed = int(await self.redis.hget(f"task:{task_id}", "failed") or 0)
                cancelled = int(await self.redis.hget(f"task:{task_id}", "cancelled") or 0)
                if not cancelled:
                    cancelled = max(0, total - success - failed)
                yield {
                    "event": "complete",
                    "data": json.dumps(
                        {"success": success, "failed": failed, "cancelled": cancelled, "total": total, "status": status},
                        ensure_ascii=False,
                    ),
                }
                return

            await asyncio.sleep(idle_sleep)
            idle_sleep = min(idle_sleep * 1.5, 2.0)
