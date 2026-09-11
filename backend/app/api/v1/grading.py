"""批改任务记录与历史。

内容数据（作答正文、笔记、错题本）存在前端 IndexedDB；
这里记录任务级指标，用于趋势统计与成本核算。
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models.schemas import GradingTaskIn, GradingTaskOut
from app.services import grading_service

router = APIRouter(prefix="/grading", tags=["grading"])


@router.post("/tasks", response_model=GradingTaskOut)
async def create_task(payload: GradingTaskIn, db: AsyncSession = Depends(get_db)):
    """上报一次批改任务的结果（前端在批改完成后调用）。"""
    row = await grading_service.save_task(db, payload)
    if row is None:
        raise HTTPException(
            status_code=503,
            detail="后端已关闭持久化（ENABLE_PERSISTENCE=False），本次任务未记录",
        )
    return row


@router.get("/tasks", response_model=list[GradingTaskOut])
async def list_tasks(
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    limit = max(1, min(limit, 500))
    return await grading_service.list_tasks(db, limit=limit, offset=max(0, offset))


@router.get("/tasks/{task_id}", response_model=GradingTaskOut)
async def get_task(task_id: str, db: AsyncSession = Depends(get_db)):
    row = await grading_service.get_task(db, task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return row


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, db: AsyncSession = Depends(get_db)):
    ok = await grading_service.delete_task(db, task_id)
    if not ok:
        raise HTTPException(status_code=404, detail="任务不存在")
    return {"deleted": True, "task_id": task_id}
