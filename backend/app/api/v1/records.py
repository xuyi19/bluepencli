"""练习记录归档接口。

批改完成后，前端把完整快照发到这里，后端落盘成 `docs/practice/*.{md,json}`。
记录页（复盘）从这里读列表与详情；后端不可用时前端会退回浏览器本地存储。
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException

from app.core.config import settings as app_settings
from app.models.schemas import PracticeRecordIn, PracticeRecordSummary
from app.services import record_service

router = APIRouter(prefix="/records", tags=["records"])


def _ensure_enabled() -> None:
    if not app_settings.ENABLE_RECORD_ARCHIVE:
        raise HTTPException(
            status_code=503,
            detail="后端已关闭记录归档（ENABLE_RECORD_ARCHIVE=False），本次未落盘",
        )


@router.post("")
async def create_record(payload: PracticeRecordIn):
    """保存一次练习记录（同 id 重复提交会覆盖）。"""
    _ensure_enabled()
    data = payload.model_dump()
    if not data.get("created_at"):
        data["created_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return record_service.save(data)


@router.get("", response_model=list[PracticeRecordSummary])
async def list_records(limit: int = 100, offset: int = 0):
    _ensure_enabled()
    limit = max(1, min(limit, 500))
    return record_service.list_records(limit=limit, offset=max(0, offset))


@router.get("/{record_id}")
async def get_record(record_id: str):
    _ensure_enabled()
    data = record_service.get_record(record_id)
    if data is None:
        raise HTTPException(status_code=404, detail="记录不存在")
    return data


@router.get("/{record_id}/markdown")
async def get_record_markdown(record_id: str):
    """取回 markdown 原文（导出 / 下载用）。"""
    _ensure_enabled()
    md = record_service.markdown_of(record_id)
    if md is None:
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"id": record_id, "markdown": md}


@router.delete("/{record_id}")
async def delete_record(record_id: str):
    _ensure_enabled()
    if not record_service.delete_record(record_id):
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"deleted": True, "id": record_id}
