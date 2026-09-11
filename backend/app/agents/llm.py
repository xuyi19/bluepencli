"""LLM 配置解析与请求体构造。

对齐 resumatch-ai 的 `agents/llm.py` 位置：所有模型相关参数的收口处。
差别在于本项目的后端是**转发式网关**——Prompt 由前端组装（单一真相源），
后端只负责安全地发出去、并发调度、记账。
"""

import re

from app.core.config import settings
from app.models.schemas import LLMConfig

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-chat"


class LLMConfigError(ValueError):
    """缺少必要配置（主要是 API Key）时抛出。"""


def resolve_llm_config(cfg: LLMConfig | None) -> dict:
    """优先使用前端传入的配置，缺省项回退到服务端 .env。"""
    final_key = (cfg.api_key if cfg and cfg.api_key else "") or settings.LLM_API_KEY
    final_base = (
        (cfg.base_url if cfg and cfg.base_url else "")
        or settings.LLM_BASE_URL
        or DEFAULT_BASE_URL
    )
    final_model = (
        (cfg.model if cfg and cfg.model else "") or settings.LLM_MODEL or DEFAULT_MODEL
    )

    if not final_key:
        raise LLMConfigError(
            "未配置 LLM API Key：请在「设置」页填写，或在服务端 .env 中配置 LLM_API_KEY"
        )

    return {
        "api_key": final_key,
        "base_url": final_base,
        "model": final_model,
    }


def build_url(base_url: str) -> str:
    """兼容用户填 `域名` / `域名/v1` / `域名/v4`（智谱）/ 完整 `.../chat/completions`。

    注意版本段不能写死成 `/v1`：智谱的兼容地址是 `.../paas/v4`，
    写死会把 `/v1` 又叠上去，拼出 `/v4/v1/chat/completions` → 404。
    前端 `api/llm.js` 的 `buildUrl` 与此处逻辑必须保持一致。
    """
    base = str(base_url or "").strip().rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if re.search(r"/v\d+$", base):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def build_payload(
    messages,
    model: str,
    temperature: float = 0.3,
    stream: bool = False,
    json_mode: bool = False,
) -> dict:
    payload: dict = {
        "model": model,
        "messages": [
            m.model_dump() if hasattr(m, "model_dump") else dict(m) for m in messages
        ],
        "temperature": temperature,
        "stream": stream,
    }
    if stream:
        # 流式也把 token 用量带回来，便于记账
        payload["stream_options"] = {"include_usage": True}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    return payload
