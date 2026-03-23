from __future__ import annotations

from pydantic import BaseModel


class TaskCreateResponse(BaseModel):
    task_id: str
    total: int
    message: str = "Task created successfully"

