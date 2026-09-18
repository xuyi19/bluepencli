# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
"""验证桌面版「实例复用」的两条分支。

背景（真踩过的坑，2026-09-14）：
    桌面版每次升级都跑**同一个默认端口**（8765），而用户升级后旧窗口往往还开着。
    早期 desktop.py 只判断"8765 上是不是 BluePencil"，于是双击新版 exe 会命中旧实例、
    把浏览器指向**旧版界面**然后自己退出 —— 用户看到的现象是"解压出来是旧版的"，
    实际新版已经装好了。这个坑极隐蔽：新进程的日志一切正常。

判据：
    ① 同版本在跑 → 复用（不启第二个服务，直接开浏览器指向它）
    ② 版本不同   → **不复用**，另起端口，并打印明确的提示

注意 patch 点（踩过一次）：
    desktop.py 里"起服务"那一步，v0.9.0 起从 `uvicorn.run(app, ...)` 语法糖改成了
    显式的 `uvicorn.Server(...)`（关页即退需要拿到 server 句柄）。测试若还去 patch
    `uvicorn.run`，就**拦不住真正的启动** —— 脚本会真的把服务起起来并阻塞在那儿，
    现象是"卡住不动"而不是"断言失败"，比报错更难查。所以这里改 patch `uvicorn.Server`。

用法：
    backend/.venv/Scripts/python.exe .tools/test-desktop-reuse.py
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
PY = BACKEND / ".venv" / "Scripts" / "python.exe"
PORT = 8765

passed = failed = 0


def t(name, fn):
    global passed, failed
    try:
        fn()
        print(f"  ✓ {name}")
        passed += 1
    except AssertionError as e:
        print(f"  ✗ {name}\n      {e}")
        failed += 1


def health():
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/v1/health", timeout=1) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def main() -> int:
    sys.path.insert(0, str(BACKEND))
    import desktop  # noqa: E402

    print("桌面版实例复用逻辑：\n")

    # ---- 前置：端口应当是干净的（否则先把旧实例关掉再跑）----
    if health() is not None:
        print(f"⚠️  {PORT} 上已有实例在跑，请先关掉再跑本脚本。")
        return 1

    t("无实例时 _running_version 返回 None", lambda: (
        None is desktop._running_version(PORT) or _fail("应为 None")
    ))

    # ---- 起一个真实实例，模拟"同版本已在跑" ----
    proc = subprocess.Popen(
        [str(PY), "desktop.py", "--no-browser"],
        cwd=str(BACKEND),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        for _ in range(60):
            if health() is not None:
                break
            time.sleep(0.5)
        h = health()
        assert h, "实例没起来"

        t("能读到实例的版本号", lambda: (
            desktop._running_version(PORT) == h["version"]
            or _fail(f"读到 {desktop._running_version(PORT)!r}，期望 {h['version']!r}")
        ))

        # ---- 分支①：同版本 → 复用，不开新服务 ----
        def branch_same():
            opened, ran = [], []
            orig_open = desktop.webbrowser.open
            orig_server = desktop.uvicorn.Server
            orig_argv = sys.argv[:]
            desktop.webbrowser.open = lambda u: opened.append(u)
            desktop.uvicorn.Server = _fake_server(ran)
            sys.argv = [sys.argv[0], "--no-browser"]
            try:
                out = _capture(desktop.main)
            finally:
                desktop.webbrowser.open = orig_open
                desktop.uvicorn.Server = orig_server
                sys.argv = orig_argv
            assert "已在运行" in out, f"应提示复用，实际输出：{out!r}"
            assert opened and str(PORT) in opened[0], f"应打开浏览器指向 {PORT}：{opened}"
            assert not ran, "同版本不该另起服务"

        t("同版本已在跑 → 复用且不启第二个服务", branch_same)

        # ---- 分支②：版本不同 → 不复用，另起端口 ----
        def branch_diff():
            opened, ran = [], []
            orig_open = desktop.webbrowser.open
            orig_server = desktop.uvicorn.Server
            orig_argv = sys.argv[:]
            # desktop.main 内部是 `from app.core.config import settings`，拿的是同一个
            # 单例对象，所以改它的属性就能骗过版本比对
            from app.core.config import settings as cfg

            real_ver = cfg.APP_VERSION
            desktop.webbrowser.open = lambda u: opened.append(u)
            desktop.uvicorn.Server = _fake_server(ran)
            sys.argv = [sys.argv[0], "--no-browser"]
            cfg.APP_VERSION = "0.0.1-fake"  # 假装当前是另一个版本
            try:
                out = _capture(desktop.main)
            finally:
                cfg.APP_VERSION = real_ver
                desktop.webbrowser.open = orig_open
                desktop.uvicorn.Server = orig_server
                sys.argv = orig_argv
            assert "旧版本" in out, f"应提示检测到旧版本，实际输出：{out!r}"
            assert "不复用" in out, f"应明说不复用，实际输出：{out!r}"
            assert ran, "版本不同时必须启动新实例"
            assert not any(str(PORT) in u for u in opened), "绝不能把用户带去旧端口"
            assert str(PORT + 1) in out, f"应改用顺延端口 {PORT + 1}：{out!r}"

        t("版本不同 → 不复用、另起端口且不打开旧界面", branch_diff)

        # ---- 分支③：显式 --port → 连"同版本复用"都要绕过 ----
        #
        # 这条分支是为**自动化探针**加的，但它是行为约定、不是测试专用的后门，
        # 所以必须和另两条一样有断言盯着。
        # 为什么探针非绕过不可：默认端口上若已有一个同版本实例，复用分支会
        # **直接 return**（把浏览器指向那个旧实例），探针起的进程随即退出 ——
        # 于是它连到的是**别人的实例**，断言全打偏。实测踩过：8765 上放一个
        # 同版本 v0.13.4 的残留，探针报"4/4 通过"，但退掉的是那个残留实例，
        # 而它自己起的进程压根没起来。这是最典型的**假绿**。
        def branch_explicit_port():
            opened, ran = [], []
            orig_open = desktop.webbrowser.open
            orig_server = desktop.uvicorn.Server
            orig_argv = sys.argv[:]
            desktop.webbrowser.open = lambda u: opened.append(u)
            desktop.uvicorn.Server = _fake_server(ran)
            sys.argv = [sys.argv[0], "--no-browser", "--port", "8899"]
            try:
                out = _capture(desktop.main)
            finally:
                desktop.webbrowser.open = orig_open
                desktop.uvicorn.Server = orig_server
                sys.argv = orig_argv
            assert ran, (
                "显式指定端口时必须真的起服务（同版本在跑也不能复用，"
                f"否则探针会连到别人的实例）：{out!r}"
            )
            assert "已在运行" not in out, f"显式端口不该走复用分支：{out!r}"
            assert "8899" in out, f"应使用命令行指定的端口 8899：{out!r}"
            assert not opened, "带 --no-browser 时不该自动开浏览器"

        t("显式 --port → 绕过同版本复用，真的另起一个", branch_explicit_port)

        # ---- 分支④：`--port=N` 等号写法同样要认 ----
        # 同一件事有两种命令行写法，只认一种就会静默退回默认端口 ——
        # 那种失败**看起来完全正常**（服务起在 8765 上了），最难发现。
        def branch_port_equals():
            assert desktop._requested_port.__doc__, "_requested_port 应有说明"
            orig_argv = sys.argv[:]
            try:
                for argv, want in (
                    ([], 8765),
                    (["--no-browser"], 8765),
                    (["--port", "8899"], 8899),
                    (["--port=8899"], 8899),
                    (["--port", "abc"], 8765),  # 非法值退回默认，不能崩
                    (["--port"], 8765),  # 缺参数退回默认，不能崩
                ):
                    sys.argv = [sys.argv[0], *argv]
                    got = desktop._requested_port()
                    assert got == want, f"{argv} → 应得 {want}，实际 {got}"
            finally:
                sys.argv = orig_argv

        t("--port 两种写法都认，非法/缺失退回默认", branch_port_equals)

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    print(f"\n合计：{passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


def _fail(msg: str):
    raise AssertionError(msg)


def _fake_server(ran: list):
    """替掉 uvicorn.Server：只记录"要求起服务"这件事，不真的监听端口。

    见文件头说明——patch 点必须跟着 desktop.py 的实现走，
    否则测试会真起服务、把脚本卡死，还不报错。
    """

    class _FakeServer:
        def __init__(self, config):
            ran.append(1)
            self.config = config
            self.should_exit = False

        def run(self):
            pass

    return _FakeServer


def _capture(fn) -> str:
    buf = io.StringIO()
    old = sys.stdout
    sys.stdout = buf
    try:
        fn()
    finally:
        sys.stdout = old
    return buf.getvalue()


if __name__ == "__main__":
    sys.exit(main())
