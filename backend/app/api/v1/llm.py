"""LLM 网关路由。

三个入口：
- POST /llm/chat         单次非流式
- POST /llm/chat/stream  单次流式（SSE，格式与 OpenAI 一致，前端解析代码可复用）
- POST /llm/chat/batch   批量并发（圆桌模式下多位老师同时阅卷）

所有调用都会记账到 llm_call_logs。
"""

import json
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import AsyncSessionLocal, get_db
from app.models.schemas import (
    BatchChatRequest,
    BatchChatResponse,
    ChatRequest,
    ChatResponse,
)
from app.services import grading_service, llm_service
from app.services.llm_service import LLMError

router = APIRouter(prefix="/llm", tags=["llm"])


def _prompt_chars(req: ChatRequest) -> int:
    return sum(len(m.content or "") for m in req.messages)


def _to_http(e: Exception) -> HTTPException:
    if isinstance(e, LLMError):
        status = 502 if (e.status == 0 or e.status >= 500) else e.status
        if status not in (400, 401, 402, 403, 404, 408, 429, 500, 502, 503):
            status = 502
        return HTTPException(status_code=status, detail=str(e))
    return HTTPException(status_code=500, detail=str(e)[:300])


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, db: AsyncSession = Depends(get_db)):
    started = time.time()
    try:
        resp = await llm_service.chat_once(req)
    except Exception as e:  # noqa: BLE001
        await grading_service.log_llm_call(
            db,
            task_id=req.task_id,
            teacher_id=req.teacher_id,
            stage=req.stage,
            model=(req.llm_config.model if req.llm_config else "") or "",
            prompt_chars=_prompt_chars(req),
            output_chars=0,
            elapsed_ms=int((time.time() - started) * 1000),
            ok=False,
            error=str(e),
        )
        raise _to_http(e) from e

    await grading_service.log_llm_call(
        db,
        task_id=req.task_id,
        teacher_id=req.teacher_id,
        stage=req.stage,
        model=resp.model,
        prompt_chars=_prompt_chars(req),
        output_chars=len(resp.content or ""),
        prompt_tokens=resp.prompt_tokens,
        completion_tokens=resp.completion_tokens,
        elapsed_ms=resp.elapsed_ms,
    )
    return resp


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """SSE 流式转发。事件格式与 OpenAI 一致，末尾附 [DONE]。"""

    async def event_gen():
        started = time.time()
        full = ""
        usage: dict = {}
        model = (req.llm_config.model if req.llm_config else "") or ""
        ok = True
        err_text = ""

        try:
            async for piece in llm_service.chat_stream(req):
                if piece.startswith("\x00USAGE"):
                    try:
                        usage = json.loads(piece[6:] or "{}")
                    except Exception:  # noqa: BLE001
                        usage = {}
                    continue
                full += piece
                yield "data: " + json.dumps(
                    {"choices": [{"delta": {"content": piece}}]}, ensure_ascii=False
                ) + "\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:  # noqa: BLE001
            ok = False
            err_text = str(e)
            logger.warning(f"流式转发失败：{e}")
            yield "data: " + json.dumps(
                {"error": {"message": err_text[:400]}}, ensure_ascii=False
            ) + "\n\n"
            yield "data: [DONE]\n\n"
        finally:
            # 流结束后独立开 session 记账，避免依赖注入生命周期问题
            try:
                async with AsyncSessionLocal() as s:
                    await grading_service.log_llm_call(
                        s,
                        task_id=req.task_id,
                        teacher_id=req.teacher_id,
                        stage=req.stage,
                        model=model,
                        prompt_chars=_prompt_chars(req),
                        output_chars=len(full),
                        prompt_tokens=int(usage.get("prompt_tokens") or 0),
                        completion_tokens=int(usage.get("completion_tokens") or 0),
                        elapsed_ms=int((time.time() - started) * 1000),
                        ok=ok,
                        error=err_text,
                    )
            except Exception as e:  # noqa: BLE001
                logger.warning(f"流式记账失败（不影响结果）：{e}")

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 关掉 nginx 缓冲，否则流式会被攒起来
        },
    )


@router.post("/chat/batch", response_model=BatchChatResponse)
async def chat_batch(req: BatchChatRequest, db: AsyncSession = Depends(get_db)):
    if not req.requests:
        raise HTTPException(status_code=400, detail="requests 不能为空")
    if len(req.requests) > 16:
        raise HTTPException(status_code=400, detail="单批最多 16 个请求")

    results, errors, elapsed = await llm_service.chat_batch(req.requests, req.concurrency)

    # 逐条记账
    for one, resp, err in zip(req.requests, results, errors):
        await grading_service.log_llm_call(
            db,
            task_id=one.task_id,
            teacher_id=one.teacher_id,
            stage=one.stage,
            model=(resp.model if resp else "") or "",
            prompt_chars=_prompt_chars(one),
            output_chars=len(resp.content or "") if resp else 0,
            prompt_tokens=resp.prompt_tokens if resp else 0,
            completion_tokens=resp.completion_tokens if resp else 0,
            elapsed_ms=resp.elapsed_ms if resp else 0,
            ok=resp is not None,
            error=err,
        )

    filled = [r for r in results if r is not None]
    return BatchChatResponse(
        results=filled,
        errors=[e for e in errors if e],
        elapsed_ms=elapsed,
    )
