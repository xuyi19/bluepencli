"""桌面版「关页即退」看门狗的测试。

这块逻辑最大的风险不是"不退出"，而是**误退出**：
刷新页面被当成关闭、后台标签被当成关掉。前者会让用户莫名其妙地掉服务，
后者在网络服务上更是灾难。所以正反两个方向都要钉死。

所有用例都直接把时间戳喂给 `tick_once(now=...)`，不真的等 6 秒——
倒计时逻辑必须是可复算的，否则只能靠"等一会儿看看"来验，那不叫测试。
"""

import time

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.session_watch import SessionWatch, watch


def _make(**kwargs):
    """建一个启用的看门狗，并记录退出动作被触发了几次。"""
    w = SessionWatch(enabled=True, grace=6.0, idle_timeout=300.0, **kwargs)
    hits = []
    w.bind_exit(lambda: hits.append(1))
    return w, hits


# ── 不该退出的情况（误杀防护） ──────────────────────────────


def test_disabled_never_exits():
    w = SessionWatch(enabled=False, grace=0.1)
    hits = []
    w.bind_exit(lambda: hits.append(1))
    w.note("a")
    w.drop("a")
    for t in range(0, 60, 5):
        assert w.tick_once(float(t)) is False
    assert hits == []


def test_no_session_never_exits():
    """只 curl 过 /docs 或 /api/v1/health 的进程不该被自己关掉。"""
    w, hits = _make()
    for t in range(0, 600, 10):
        assert w.tick_once(float(t)) is False
    assert hits == []


def test_active_session_stays():
    w, hits = _make()
    base = time.monotonic()
    w.note("tab-1")
    for t in range(0, 120, 5):
        assert w.tick_once(base + t) is False
    assert hits == []


def test_one_of_two_tabs_closing_keeps_running():
    """两个标签页只关掉其中一个 —— 还有一个活着，绝不能退。"""
    w, hits = _make()
    base = time.monotonic()
    w.note("tab-1")
    w.note("tab-2")
    w.drop("tab-2")
    for t in range(0, 60, 5):
        assert w.tick_once(base + t) is False
    assert hits == []


def test_reload_within_grace_cancels_exit():
    """刷新 = 先 bye 后 hello。bye 之后、grace 之内 hello 回来必须取消倒计时。"""
    w, hits = _make()
    base = time.monotonic()

    w.note("tab-1")
    w.tick_once(base)                       # 正常状态
    w.drop("tab-1")                         # 页面开始卸载
    w.tick_once(base + 1.0)                 # 会话表空了，起倒计时
    w.note("tab-1-new")                     # 新页面在 grace 内注册回来
    for t in range(2, 120, 5):
        assert w.tick_once(base + t) is False, "刷新后的新会话应当取消退出倒计时"
    assert hits == []


def test_blank_sid_ignored():
    w, _ = _make()
    w.note("")
    w.note("   ")
    assert w.state()["sessions"] == 0
    assert w.state()["pending_exit"] is False


# ── 该退出的情况 ─────────────────────────────────────────


def test_exits_after_grace():
    w, hits = _make()
    base = time.monotonic()
    w.note("tab-1")
    w.tick_once(base)

    w.drop("tab-1")
    assert w.tick_once(base) is False, "刚变空就退出 = 刷新会被误杀"
    assert w.tick_once(base + 5.9) is False, "未到宽限期不该退"
    assert w.tick_once(base + 6.0) is True, "过了宽限期应当退出"
    assert hits == [1]


def test_exit_fires_once():
    w, hits = _make()
    base = time.monotonic()
    w.note("tab-1")
    w.drop("tab-1")
    w.tick_once(base)
    assert w.tick_once(base + 10) is True
    for t in range(11, 60, 3):
        assert w.tick_once(base + t) is False
    assert hits == [1], "退出动作重复触发会把日志刷屏，也可能重复关服务"


def test_stale_session_reaped_then_exit():
    """浏览器崩溃 / 被强杀时不会有 bye，只能靠心跳过期兜底。"""
    w, hits = _make()
    base = time.monotonic()
    w.note("tab-1")

    assert w.tick_once(base + 100) is False, "心跳还在容忍期内，不当作僵尸"
    assert w.tick_once(base + 301) is False, "刚判定为僵尸，倒计时才开始"
    assert w.tick_once(base + 308) is True
    assert hits == [1]


def test_state_reports_pending_exit():
    w, _ = _make()
    base = time.monotonic()
    w.note("tab-1")
    assert w.state()["pending_exit"] is False
    w.drop("tab-1")
    w.tick_once(base)
    assert w.state()["sessions"] == 0
    assert w.state()["pending_exit"] is True


# ── 与 API 的接缝 ───────────────────────────────────────


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture(autouse=True)
def _reset_singleton():
    """API 用例会打到模块级单例上，用完清干净，免得串味。"""
    watch._sessions.clear()
    watch._empty_since = None
    yield
    watch._sessions.clear()
    watch._empty_since = None


async def test_session_endpoints_register_and_drop(client):
    res = await client.post("/api/v1/session/hello", json={"sid": "s-1"})
    assert res.status_code == 200
    assert res.json()["sessions"] == 1

    res = await client.post("/api/v1/session/ping", json={"sid": "s-1"})
    assert res.json()["sessions"] == 1

    res = await client.post("/api/v1/session/bye", json={"sid": "s-1"})
    assert res.json()["sessions"] == 0


async def test_endpoints_inert_when_not_desktop(client):
    """网站版跑的是同一份后端：端点照常应答，但不会自动退出。"""
    res = await client.get("/api/v1/session/state")
    body = res.json()
    assert body["desktop"] == watch.enabled
    assert body["exited"] is False


async def test_health_reports_desktop_flag(client):
    res = await client.get("/api/v1/health")
    assert "desktop" in res.json(), "前端靠这个字段决定要不要挂「关页即退」"
