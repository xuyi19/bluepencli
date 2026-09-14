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
            orig_open, orig_run = desktop.webbrowser.open, desktop.uvicorn.run
            desktop.webbrowser.open = lambda u: opened.append(u)
            desktop.uvicorn.run = lambda *a, **k: ran.append(1)
            try:
                out = _capture(desktop.main)
            finally:
                desktop.webbrowser.open, desktop.uvicorn.run = orig_open, orig_run
            assert "已在运行" in out, f"应提示复用，实际输出：{out!r}"
            assert opened and str(PORT) in opened[0], f"应打开浏览器指向 {PORT}：{opened}"
            assert not ran, "同版本不该另起服务"

        t("同版本已在跑 → 复用且不启第二个服务", branch_same)

        # ---- 分支②：版本不同 → 不复用，另起端口 ----
        def branch_diff():
            opened, ran = [], []
            orig_open, orig_run = desktop.webbrowser.open, desktop.uvicorn.run
            # desktop.main 内部是 `from app.core.config import settings`，拿的是同一个
            # 单例对象，所以改它的属性就能骗过版本比对
            from app.core.config import settings as cfg

            real_ver = cfg.APP_VERSION
            desktop.webbrowser.open = lambda u: opened.append(u)
            desktop.uvicorn.run = lambda *a, **k: ran.append(1)
            cfg.APP_VERSION = "0.0.1-fake"  # 假装当前是另一个版本
            try:
                out = _capture(desktop.main)
            finally:
                cfg.APP_VERSION = real_ver
                desktop.webbrowser.open, desktop.uvicorn.run = orig_open, orig_run
            assert "旧版本" in out, f"应提示检测到旧版本，实际输出：{out!r}"
            assert "不复用" in out, f"应明说不复用，实际输出：{out!r}"
            assert ran, "版本不同时必须启动新实例"
            assert not any(str(PORT) in u for u in opened), "绝不能把用户带去旧端口"
            assert str(PORT + 1) in out, f"应改用顺延端口 {PORT + 1}：{out!r}"

        t("版本不同 → 不复用、另起端口且不打开旧界面", branch_diff)

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
