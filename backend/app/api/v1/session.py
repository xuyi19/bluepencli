from fastapi import APIRouter
from pydantic import BaseModel

from app.services.session_watch import watch

router = APIRouter(tags=["session"])


class SessionIn(BaseModel):
    sid: str = ""


@router.post("/session/hello")
async def session_hello(payload: SessionIn):
    """页面（重新）注册自己。刷新页面时它会把退出倒计时取消掉。"""
    watch.note(payload.sid)
    return watch.state()


@router.post("/session/ping")
async def session_ping(payload: SessionIn):
    """心跳：只用于让后端回收僵尸会话，不参与退出判定。"""
    watch.note(payload.sid)
    return watch.state()


@router.post("/session/bye")
async def session_bye(payload: SessionIn):
    """页面卸载时注销自己。全部注销后，后端等一小段时间就退出。

    用 POST 而不是 GET，是因为浏览器在 `pagehide` 阶段只保证能把
    `navigator.sendBeacon` 的 POST 发出去（fetch 会被掐掉）。
    """
    watch.drop(payload.sid)
    return watch.state()


@router.get("/session/state")
async def session_state():
    """看一眼当前有几个页面连着（排查用，也方便探针断言）。"""
    return watch.state()
