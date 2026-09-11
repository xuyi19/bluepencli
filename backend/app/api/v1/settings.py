"""设置相关：LLM 连通性测试。

对齐 resumatch-ai 的 `/settings/test-llm`：前端「测试连接」按钮打这里。
"""

import time

from fastapi import APIRouter
from loguru import logger

from app.core.config import settings
from app.models.schemas import ChatMessage, ChatRequest, LLMConfig, TestLLMRequest, TestLLMResponse
from app.services import llm_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/llm-default")
async def llm_default():
    """告诉前端服务端是否已托管 LLM 配置。

    桌面版/网站版可把 Key 放在服务端（`config.json` 或 `.env`），
    使用者就无需再填任何东西。**只回传"是否已配置"，不回传 Key 本身。**
    """
    return {
        "server_key_configured": bool(settings.LLM_API_KEY),
        "base_url": settings.LLM_BASE_URL,
        "model": settings.LLM_MODEL,
    }


@router.post("/test-llm", response_model=TestLLMResponse)
async def test_llm(req: TestLLMRequest):
    if not req.api_key:
        # 允许空 key——此时回退到服务端 .env 配置
        logger.info("测试连接未传 Key，尝试使用服务端配置")

    started = time.time()
    try:
        resp = await llm_service.chat_once(
            ChatRequest(
                messages=[ChatMessage(role="user", content="回复两个字：正常")],
                temperature=0,
                llm_config=LLMConfig(
                    api_key=req.api_key or None,
                    base_url=req.base_url or None,
                    model=req.model or None,
                ),
            )
        )
        logger.info(f"LLM 测试成功：{resp.model} → {resp.content[:50]}")
        return TestLLMResponse(
            success=True,
            model=resp.model,
            response=(resp.content or "").strip()[:50],
            elapsed_ms=int((time.time() - started) * 1000),
        )
    except Exception as e:  # noqa: BLE001
        logger.warning(f"LLM 测试失败：{e}")
        return TestLLMResponse(
            success=False,
            elapsed_ms=int((time.time() - started) * 1000),
            error=str(e)[:300],
        )
