from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_db
from app.models.schemas import HealthOut

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthOut)
async def health(db: AsyncSession = Depends(get_db)):
    """健康检查：前端靠它判断是否启用「后端通道」。"""
    db_status = "ok"
    try:
        await db.execute(text("SELECT 1"))
    except Exception as e:  # noqa: BLE001
        db_status = f"error: {e}"

    return HealthOut(
        status="ok",
        app=settings.APP_NAME,
        version=settings.APP_VERSION,
        db=db_status,
    )
