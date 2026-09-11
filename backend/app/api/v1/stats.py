from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.models.schemas import StatsOut
from app.services import grading_service

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("", response_model=StatsOut)
async def get_stats(db: AsyncSession = Depends(get_db)):
    """汇总统计：任务数、调用次数、token 消耗、估算成本。"""
    return await grading_service.build_stats(db)
