# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
"""桌面版看门狗：浏览器页面全关了就结束进程。

**为什么需要它**
桌面版是「双击即用」的形态，用户关掉页面后通常以为程序也退出了，
但黑窗口（和它守着的 uvicorn）还在后台跑着。下次再双击时，启动器一看
默认端口上有个**同版本**实例在跑，就会直接打开浏览器指向它 —— 程序看着
是"启动"了，其实什么也没重启。用户升级后遇到的老问题（打开旧界面），
根子就在这里：进程从来没退干净过。
所以「关页即退」不是锦上添花，是把这类状态从根上消掉。

**判定规则（三条同时成立才退，缺一不可）**
1. **曾经有过页面会话** —— 否则只 curl 一下 `/docs` 就被判成"页面都关完了"
2. 当前没有任何活跃会话
3. 这种"空"状态已持续超过 `grace` 秒 —— 给**刷新页面**留出重新注册的时间窗

刷新页面的顺序是「先 bye 后 hello」：bye 让会话表变空，hello 在 grace 内
回来就把倒计时取消掉。所以 grace 必须留够页面重载的时间，不能太短。

**心跳不参与退出判定**：后台标签页的定时器会被浏览器节流（可能压到 1 分钟以上），
拿它当"页面还活着"的证据会误杀。心跳只用来回收**僵尸会话**——浏览器崩溃或
被强杀时不会发 bye，只能靠心跳过期来清理。
"""

import threading
import time
from typing import Callable

# 页面重载的时间窗：太短会把"刷新"误判成"关闭"
DEFAULT_GRACE = 6.0
# 僵尸会话的容忍时长：只兜"浏览器崩了"这种异常路径，不参与正常退出判定
DEFAULT_IDLE = 300.0


class SessionWatch:
    """页面会话登记表 + 退出倒计时。

    刻意做成**不依赖 asyncio 的纯 threading 实现**：退出动作要能在
    uvicorn 事件循环之外触发（把 `server.should_exit` 置真），
    且 tick 逻辑是纯函数式的，可以直接在单测里喂时间戳复算，
    不必真的等 6 秒。
    """

    def __init__(
        self,
        *,
        enabled: bool = False,
        grace: float = DEFAULT_GRACE,
        idle_timeout: float = DEFAULT_IDLE,
        tick: float = 1.0,
    ) -> None:
        self.enabled = enabled
        self.grace = grace
        self.idle_timeout = idle_timeout
        self.tick = tick
        self._sessions: dict[str, float] = {}
        self._empty_since: float | None = None
        self._ever_active = False
        self._exited = False
        self._on_exit: Callable[[], None] | None = None
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None

    # ── 被 API 调用的三个动作 ──────────────────────────────

    def note(self, sid: str) -> None:
        """注册 / 续期一个页面会话（hello 与 ping 都走这里）。"""
        sid = str(sid or "").strip()
        if not sid:
            return
        with self._lock:
            self._sessions[sid] = time.monotonic()
            # 会话回来了，取消正在进行的退出倒计时
            self._empty_since = None
            self._ever_active = True

    def drop(self, sid: str) -> None:
        """页面卸载时注销自己。幂等——两个卸载事件各发一次也无妨。"""
        with self._lock:
            self._sessions.pop(str(sid or "").strip(), None)

    def state(self) -> dict:
        with self._lock:
            return {
                "desktop": self.enabled,
                "sessions": len(self._sessions),
                "pending_exit": self._empty_since is not None,
                "exited": self._exited,
            }

    # ── 生命周期 ────────────────────────────────────────

    def bind_exit(self, fn: Callable[[], None]) -> None:
        """注册真正的退出动作（桌面版里就是让 uvicorn 收工）。"""
        self._on_exit = fn

    def start(self) -> None:
        if not self.enabled or self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, daemon=True, name="session-watch")
        self._thread.start()

    def _loop(self) -> None:
        while True:
            time.sleep(self.tick)
            self.tick_once()

    def tick_once(self, now: float | None = None) -> bool:
        """走一拍；返回是否**在本次调用里**触发了退出。

        抽成可传 `now` 的形式，就是为了让单测能复算倒计时：
        喂几个递增的时间戳就能验完"刷新不误杀 / 关页才退"两条分支。
        """
        if not self.enabled:
            return False

        now = time.monotonic() if now is None else now
        with self._lock:
            # ① 回收僵尸会话：浏览器崩溃时不会有 bye，只能让心跳过期
            stale = [s for s, t in self._sessions.items() if now - t > self.idle_timeout]
            for s in stale:
                del self._sessions[s]

            if self._sessions:
                self._empty_since = None
                return False
            # 从没打开过页面（例如只访问了 /docs）：不动手，免得误杀
            if not self._ever_active:
                return False
            if self._empty_since is None:
                self._empty_since = now
                return False
            if now - self._empty_since < self.grace:
                return False
            if self._exited:
                return False
            self._exited = True
            fn = self._on_exit

        if fn is not None:
            fn()
        return True


# 全局单例。enabled 由配置决定：只有 desktop.py 把 DESKTOP_MODE 置真时才生效，
# 所以网站版 / 本地开发跑同一份代码也不会被"关页"误伤。
from app.core.config import settings as _settings  # noqa: E402

watch = SessionWatch(enabled=_settings.DESKTOP_MODE)
