from __future__ import annotations

import asyncio
import json
import os
import sys
import unittest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.task_engine import TaskEngine


class FakeRedis:
    def __init__(self):
        self._hash: dict[str, dict[str, str]] = {}
        self._list: dict[str, list[str]] = {}

    async def hset(self, key: str, mapping: dict[str, object]) -> None:
        row = self._hash.setdefault(key, {})
        for k, v in mapping.items():
            row[k] = str(v)

    async def hget(self, key: str, field: str) -> str | None:
        return self._hash.get(key, {}).get(field)

    async def hgetall(self, key: str) -> dict[str, str]:
        return dict(self._hash.get(key, {}))

    async def expire(self, _key: str, _ttl: int) -> None:
        return None

    async def rpush(self, key: str, *values: str) -> None:
        lst = self._list.setdefault(key, [])
        lst.extend(values)

    async def llen(self, key: str) -> int:
        return len(self._list.get(key, []))

    async def ltrim(self, key: str, start: int, end: int) -> None:
        lst = self._list.get(key, [])
        if not lst:
            return None
        # 兼容 end=-1 这类用法
        if end < 0:
            end = len(lst) + end
        if start < 0:
            start = len(lst) + start
        start = max(0, start)
        end = min(len(lst) - 1, end)
        if start > end:
            self._list[key] = []
            return None
        self._list[key] = lst[start : end + 1]

    async def hincrby(self, key: str, field: str, amount: int = 1) -> int:
        row = self._hash.setdefault(key, {})
        current = int(row.get(field, "0") or "0")
        current += int(amount)
        row[field] = str(current)
        return current

    async def lpop(self, key: str) -> str | None:
        lst = self._list.get(key, [])
        if not lst:
            return None
        return lst.pop(0)

    async def lindex(self, key: str, index: int) -> str | None:
        lst = self._list.get(key, [])
        if index < 0 or index >= len(lst):
            return None
        return lst[index]

    async def lrange(self, key: str, start: int, end: int) -> list[str]:
        lst = self._list.get(key, [])
        if not lst:
            return []
        if end < 0:
            end = len(lst) + end
        if start < 0:
            start = len(lst) + start
        start = max(0, start)
        end = min(len(lst) - 1, end)
        if start > end:
            return []
        return list(lst[start : end + 1])


class TaskEngineStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_task_supports_resume_by_index(self):
        redis = FakeRedis()
        engine = TaskEngine(redis)  # type: ignore[arg-type]

        task_id = await engine.create_task(
            "test",
            items=[{"domain": "a.com"}, {"domain": "b.com"}],
            user_id="u",
        )

        async def executor(item: dict) -> dict:
            await asyncio.sleep(0)
            return {"message": f"ok:{item.get('domain')}"}

        await engine._execute(task_id, executor, before_item=None, after_item=None)

        async def collect(start: int) -> list[dict]:
            out: list[dict] = []
            async for evt in engine.stream_task(task_id, start=start):
                if evt.get("event") == "heartbeat":
                    continue
                out.append(evt)
            return out

        events0 = await collect(0)
        ids0 = [e.get("id") for e in events0]
        self.assertEqual(ids0, ["0", "1", "2"])

        events1 = await collect(1)
        ids1 = [e.get("id") for e in events1]
        self.assertEqual(ids1, ["1", "2"])

        last = events0[-1]
        self.assertEqual(last.get("event"), "complete")
        data = json.loads(last.get("data") or "{}")
        self.assertEqual(data.get("total"), 2)


if __name__ == "__main__":
    unittest.main()
