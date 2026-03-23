from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends
from fastapi import Request
from fastapi.responses import StreamingResponse
from redis.asyncio import Redis
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_current_user_header_or_query, get_http_client, get_redis
from app.core.exceptions import ForbiddenError, NotFoundError, ValidationError
from app.database import get_db
from app.models.user import User
from app.services.task_retry import retry_failed_task
from app.services.task_engine import TaskEngine

router = APIRouter()


def _ensure_task_owner(task: dict, user: User) -> None:
    owner_id = str(task.get("user_id") or "").strip()
    if not owner_id:
        raise NotFoundError("任务不存在")
    if owner_id != str(user.id):
        raise ForbiddenError("无权访问该任务")


def _safe_int(value: object, default: int = 0) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except Exception:  # noqa: BLE001
        return default


def _safe_json_loads(raw: str) -> dict:
    try:
        obj = json.loads(raw)
    except Exception:  # noqa: BLE001
        return {}
    return obj if isinstance(obj, dict) else {}


def _parse_dt(raw: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:  # noqa: BLE001
        return None


@router.get("")
async def list_tasks(
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    only_failed: bool = False,
    q: str | None = None,
    user: User = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
) -> dict:
    limit = max(1, min(200, int(limit or 50)))
    offset = max(0, int(offset or 0))

    user_tasks_key = f"user:{user.id}:tasks"
    task_ids: list[str] = []
    try:
        task_ids = [str(x) for x in (await redis.zrevrange(user_tasks_key, 0, 499)) or []]
    except Exception:  # noqa: BLE001
        task_ids = []

    items: list[dict] = []
    if task_ids:
        try:
            pipe = redis.pipeline()
            for tid in task_ids:
                pipe.hgetall(f"task:{tid}")
            task_data_list = await pipe.execute()
        except Exception:  # noqa: BLE001
            task_data_list = []

        for tid, data in zip(task_ids, task_data_list):
            if not isinstance(data, dict) or not data:
                continue
            try:
                _ensure_task_owner(data, user)
            except Exception:  # noqa: BLE001
                continue

            meta = _safe_json_loads(str(data.get("metadata") or ""))
            items.append(
                {
                    "task_id": tid,
                    "status": str(data.get("status") or "").strip().lower(),
                    "type": str(data.get("type") or "").strip(),
                    "current": _safe_int(data.get("current"), 0),
                    "total": _safe_int(data.get("total"), 0),
                    "success": _safe_int(data.get("success"), 0),
                    "failed": _safe_int(data.get("failed"), 0),
                    "cancelled": _safe_int(data.get("cancelled"), 0),
                    "created_at": str(data.get("created_at") or "").strip(),
                    "finished_at": str(data.get("finished_at") or "").strip(),
                    "metadata": meta,
                }
            )

    # 排序：按 created_at 倒序
    items.sort(
        key=lambda x: _parse_dt(str(x.get("created_at") or "")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )

    status_q = str(status or "").strip().lower()
    if status_q:
        items = [x for x in items if str(x.get("status") or "") == status_q]
    if only_failed:
        items = [x for x in items if _safe_int(x.get("failed"), 0) > 0]

    q_raw = str(q or "").strip().lower()
    if q_raw:
        def _match(x: dict) -> bool:
            if q_raw in str(x.get("task_id") or "").lower():
                return True
            if q_raw in str(x.get("type") or "").lower():
                return True
            meta_text = json.dumps(x.get("metadata") or {}, ensure_ascii=False, default=str).lower()
            return q_raw in meta_text

        items = [x for x in items if _match(x)]

    total = len(items)
    sliced = items[offset : offset + limit]
    return {"items": sliced, "total": total, "limit": limit, "offset": offset}


@router.get("/{task_id}")
async def get_task_status(task_id: str, _user: User = Depends(get_current_user), redis: Redis = Depends(get_redis)) -> dict:
    data = await redis.hgetall(f"task:{task_id}")
    if not data:
        raise NotFoundError("任务不存在")
    _ensure_task_owner(data, _user)
    return data


@router.post("/{task_id}/retry-failed")
async def retry_failed(
    task_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    http: httpx.AsyncClient = Depends(get_http_client),
) -> dict:
    if not task_id:
        raise ValidationError("task_id 不能为空")
    return await retry_failed_task(task_id=task_id, user=user, db=db, redis=redis, http=http)


@router.get("/{task_id}/stream")
async def stream(
    task_id: str,
    request: Request,
    _user: User = Depends(get_current_user_header_or_query),
    redis: Redis = Depends(get_redis),
):
    task = await redis.hgetall(f"task:{task_id}")
    if not task:
        raise NotFoundError("任务不存在")
    _ensure_task_owner(task, _user)
    engine = TaskEngine(redis)

    start = 0
    raw_last_id = request.headers.get("Last-Event-ID")
    raw_cursor = request.query_params.get("cursor")
    if raw_last_id:
        try:
            last_id = int(raw_last_id)
            start = max(0, last_id + 1)
        except ValueError:
            start = 0
    elif raw_cursor:
        try:
            start = max(0, int(raw_cursor))
        except ValueError:
            start = 0

    return EventSourceResponse(engine.stream_task(task_id, start=start))


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str, user: User = Depends(get_current_user), redis: Redis = Depends(get_redis)) -> dict:
    task = await redis.hgetall(f"task:{task_id}")
    if not task:
        raise NotFoundError("任务不存在")
    _ensure_task_owner(task, user)

    status = str(task.get("status") or "").strip().lower()
    if status in {"completed", "cancelled"}:
        return {"status": status}

    await redis.hset(
        f"task:{task_id}",
        mapping={"status": "cancelling", "cancel_requested_at": datetime.now(timezone.utc).isoformat()},
    )
    return {"status": "cancelling"}


@router.get("/{task_id}/export")
async def export_task_results(
    task_id: str,
    user: User = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
) -> StreamingResponse:
    task = await redis.hgetall(f"task:{task_id}")
    if not task:
        raise NotFoundError("任务不存在")
    _ensure_task_owner(task, user)

    task_type = str(task.get("type") or "").strip() or "task"
    filename = f"{task_type}-{task_id}.csv"

    async def _iter_csv():
        yield "\ufeff".encode("utf-8")
        headers = ["domain", "status", "message", "detail"]
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        yield buffer.getvalue().encode("utf-8")
        buffer.seek(0)
        buffer.truncate(0)

        key = f"task:{task_id}:results"
        start = 0
        batch = 1000
        while True:
            raw_rows = await redis.lrange(key, start, start + batch - 1)
            if not raw_rows:
                break
            for raw in raw_rows:
                try:
                    obj = json.loads(raw)
                except Exception:  # noqa: BLE001
                    continue
                if not isinstance(obj, dict):
                    continue
                writer.writerow(obj)
                chunk = buffer.getvalue()
                if chunk:
                    yield chunk.encode("utf-8")
                    buffer.seek(0)
                    buffer.truncate(0)
            start += batch

    return StreamingResponse(
        _iter_csv(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
