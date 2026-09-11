"""后端接口冒烟测试：只覆盖不依赖外部网络的路径。

LLM 实际调用不在单测范围（需要真实 Key），放在联调阶段验证。
"""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def test_root(client):
    """`/` 的实际返回取决于是否已构建前端：

    - 有 `frontend/dist`（或打包后的 `web/`）→ 返回界面（桌面版就靠这个）
    - 没有 → 返回 JSON 提示，而不是 404

    两种都算正常，所以按 content-type 分支断言。
    """
    res = await client.get("/")
    assert res.status_code == 200
    ctype = res.headers.get("content-type", "")
    if "text/html" in ctype:
        assert "<title>" in res.text
    else:
        assert "API" in res.json()["message"]


async def test_health(client):
    res = await client.get("/api/v1/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["app"]


async def test_llm_default(client):
    """服务端托管配置查询：只回"是否已配置"，**绝不回传 Key 本身**。"""
    res = await client.get("/api/v1/settings/llm-default")
    assert res.status_code == 200
    body = res.json()
    assert isinstance(body["server_key_configured"], bool)
    assert "api_key" not in body
    assert body["base_url"] and body["model"]


async def test_chat_without_key_fails(client):
    """未配置任何 Key 时，调用应明确报错而不是静默失败。"""
    res = await client.post(
        "/api/v1/llm/chat",
        json={
            "messages": [{"role": "user", "content": "hi"}],
            "llm_config": {"api_key": "", "base_url": "", "model": ""},
        },
    )
    assert res.status_code >= 400
    detail = str(res.json().get("detail", ""))
    assert "API Key" in detail or "key" in detail.lower()


async def test_batch_rejects_empty(client):
    res = await client.post("/api/v1/llm/chat/batch", json={"requests": []})
    assert res.status_code == 400


@pytest.mark.parametrize(
    "base, expected",
    [
        # 只填域名 → 补默认 /v1
        ("https://api.deepseek.com", "https://api.deepseek.com/v1/chat/completions"),
        # 带 /v1（DeepSeek/OpenAI 常见写法）
        (
            "https://api.deepseek.com/v1",
            "https://api.deepseek.com/v1/chat/completions",
        ),
        # 带 /v4（智谱 GLM 的兼容地址）——曾经被拼成 /v4/v1/... 导致 404
        (
            "https://open.bigmodel.cn/api/paas/v4",
            "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        ),
        # 已经写了完整路径 → 原样返回
        (
            "https://api.deepseek.com/v1/chat/completions",
            "https://api.deepseek.com/v1/chat/completions",
        ),
        # 末尾多余的斜杠要能容忍
        (
            "https://open.bigmodel.cn/api/paas/v4/",
            "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        ),
    ],
)
def test_build_url_versions(base, expected):
    """URL 拼接必须容忍任意版本段（/v1、/v4…），不能写死 /v1。

    回归背景：真机上用智谱测试连接报 404，请求打到了
    `/v4/v1/chat/completions` —— 后端把 /v1 又叠在了 /v4 后面。
    """
    from app.agents.llm import build_url

    assert build_url(base) == expected

