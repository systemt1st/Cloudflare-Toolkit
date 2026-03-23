from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.operation_log import OperationLog
from app.models.user import User
from app.schemas.logs import OperationLogItem, OperationLogListResponse

router = APIRouter()


@router.get("", response_model=OperationLogListResponse)
async def list_operation_logs(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    operation_type: str | None = None,
    target_domain: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OperationLogListResponse:
    filters = [OperationLog.user_id == current_user.id]
    if operation_type:
        filters.append(OperationLog.operation_type == operation_type)
    if target_domain:
        filters.append(OperationLog.target_domain.ilike(f"%{target_domain.strip()}%"))

    total = await db.scalar(select(func.count()).select_from(OperationLog).where(*filters)) or 0
    result = await db.execute(
        select(OperationLog).where(*filters).order_by(OperationLog.created_at.desc()).offset(offset).limit(limit)
    )
    rows = result.scalars().all()

    return OperationLogListResponse(
        items=[
            OperationLogItem(
                id=str(r.id),
                operation_type=r.operation_type,
                target_domain=r.target_domain,
                result=r.result,
                details=r.details,
                created_at=r.created_at,
            )
            for r in rows
        ],
        total=int(total),
        limit=limit,
        offset=offset,
    )

