"""LLM 调用服务：单次 / 流式 / 批量并发。

这是后端的核心价值所在——前端直连 API 会撞 CORS，且 Key 暴露在浏览器里；
走这里则统一了超时、重试、退避、并发限流与用量统计。
"""

import asyncio
import json
import time
from collections.abc import AsyncIterator

import httpx
from loguru import logger

from app.agents.llm import build_payload, build_url, resolve_llm_config
from app.core.config import settings
from app.models.schemas import ChatRequest, ChatResponse

_client: httpx.AsyncClient | None = None


class LLMError(Exception):
    """上游 LLM 返回错误。status 为 HTTP 状态码，0 表示网络层失败。"""

    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=15.0,
                read=settings.LLM_TIMEOUT,
                write=60.0,
                pool=15.0,
            ),
            limits=httpx.Limits(
                max_connections=32,
                max_keepalive_connections=16,
            ),
        )
    return _client


async def close_client() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
        _client = None


def _friendly(status: int, detail: str, url: str) -> LLMError:
    detail = (detail or "")[:400]
    if status == 401:
        return LLMError(f"API Key 无效或无权限（401）：{detail}", status)
    if status == 402:
        return LLMError(f"余额不足（402）：{detail}", status)
    if status == 429:
        return LLMError(f"请求过于频繁（429）：{detail}", status)
    if status >= 500:
        return LLMError(f"上游服务异常（{status}）：{detail}", status)
    return LLMError(f"请求失败（{status}）：{detail}", status)


def _extract_error(text: str) -> str:
    try:
        return json.loads(text).get("error", {}).get("message") or text
    except Exception:
        return text


async def chat_once(req: ChatRequest) -> ChatResponse:
    """非流式单次调用（含重试）。"""
    cfg = resolve_llm_config(req.llm_config)
    url = build_url(cfg["base_url"])
    payload = build_payload(
        req.messages, cfg["model"], req.temperature, stream=False, json_mode=req.json_mode
    )

    client = get_client()
    started = time.time()
    last_err: Exception | None = None

    for attempt in range(settings.LLM_MAX_RETRIES + 1):
        try:
            res = await client.post(
                url,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {cfg['api_key']}",
                },
            )
            if res.status_code >= 400:
                err = _friendly(res.status_code, _extract_error(res.text), url)
                # 4xx（除 429）重试无意义
                if res.status_code < 500 and res.status_code != 429:
                    raise err
                last_err = err
            else:
                data = res.json()
                choice = (data.get("choices") or [{}])[0]
                usage = data.get("usage") or {}
                return ChatResponse(
                    content=(choice.get("message") or {}).get("content") or "",
                    model=data.get("model") or cfg["model"],
                    elapsed_ms=int((time.time() - started) * 1000),
                    prompt_tokens=int(usage.get("prompt_tokens") or 0),
                    completion_tokens=int(usage.get("completion_tokens") or 0),
                    finish_reason=choice.get("finish_reason") or "",
                )
        except LLMError as e:
            if e.status and e.status < 500 and e.status != 429:
                raise
            last_err = e
        except httpx.HTTPError as e:
            last_err = LLMError(f"网络请求失败：{e}", 0)

        if attempt < settings.LLM_MAX_RETRIES:
            backoff = 1.5 * (2**attempt)
            logger.warning(f"LLM 调用失败，{backoff:.1f}s 后重试（第 {attempt + 1} 次）：{last_err}")
            await asyncio.sleep(backoff)

    raise last_err or LLMError("未知错误")


async def chat_stream(req: ChatRequest) -> AsyncIterator[str]:
    """流式调用，逐段吐出增量文本；结束时以特殊标记附带用量。"""
    cfg = resolve_llm_config(req.llm_config)
    url = build_url(cfg["base_url"])
    payload = build_payload(
        req.messages, cfg["model"], req.temperature, stream=True, json_mode=req.json_mode
    )

    client = get_client()
    usage: dict = {}

    async with client.stream(
        "POST",
        url,
        json=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg['api_key']}",
        },
    ) as res:
        if res.status_code >= 400:
            body = (await res.aread()).decode("utf-8", "ignore")
            raise _friendly(res.status_code, _extract_error(body), url)

        async for line in res.aiter_lines():
            if not line or not line.startswith("data:"):
                continue
            chunk = line[5:].strip()
            if chunk == "[DONE]":
                break
            try:
                obj = json.loads(chunk)
            except Exception:
                continue
            if obj.get("usage"):
                usage = obj["usage"]
            choices = obj.get("choices") or []
            if not choices:
                continue
            delta = (choices[0].get("delta") or {}).get("content") or ""
            if delta:
                yield delta

    yield "\x00USAGE" + json.dumps(usage, ensure_ascii=False)


async def chat_batch(
    requests: list[ChatRequest], concurrency: int | None = None
) -> tuple[list[ChatResponse | None], list[str], int]:
    """并发批量调用——圆桌模式下多位老师同时阅卷就靠这个。

    单个失败不影响其他（对应位返回 None，错误信息单独收集）。
    """
    limit = max(1, min(concurrency or settings.LLM_MAX_CONCURRENCY, 16))
    sem = asyncio.Semaphore(limit)
    started = time.time()

    async def run(req: ChatRequest):
        async with sem:
            try:
                return await chat_once(req)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"批量调用中单项失败：{e}")
                return e

    raw = await asyncio.gather(*(run(r) for r in requests))

    results: list[ChatResponse | None] = []
    errors: list[str] = []
    for item in raw:
        if isinstance(item, Exception):
            results.append(None)
            errors.append(str(item)[:300])
        else:
            results.append(item)
            errors.append("")

    return results, errors, int((time.time() - started) * 1000)
