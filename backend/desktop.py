# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
"""蓝笔申论 · 桌面版启动器

双击 exe（或 `python desktop.py`）后：
  1. 找端口起本地服务（界面 + API 同一个进程，无跨域）
  2. 自动打开默认浏览器
  3. **浏览器页面全关了就自动退出**；关控制台窗口同样退出

设计要点：
- **只复用「同版本」的已运行实例**。重复双击同一版时不会启第二份服务，直接开浏览器指向已在跑的那个；
  但若那个实例是**别的版本**（用户升级后旧窗口还开着），绝不复用——见下面 _running_version 的注释。
- **关页即退**（见 _shutdown_on_page_close）。桌面版最容易被忽略的状态是"进程其实还在跑"：
  用户以为关了页面就结束了，下次双击命中残留实例、什么也没重启。让它退干净，这类问题就不存在了。
- 端口冲突自动顺延，不需要用户改配置。
- 传 app 对象给 uvicorn（而不是 "app.main:app" 字符串），避免打包后动态导入失败。
"""

import os
import socket
import sys
import threading
import time
import webbrowser

import uvicorn

DEFAULT_PORT = 8765
PORT_SCAN_RANGE = 20


def _enable_utf8_console() -> None:
    """Windows 控制台默认 GBK，中文日志会乱码。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001
            pass


def _port_free(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def _pick_port(preferred: int = DEFAULT_PORT) -> int:
    for port in range(preferred, preferred + PORT_SCAN_RANGE):
        if _port_free(port):
            return port
    # 顺延范围也被占满时，交给系统分配
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _already_running(port: int, timeout: float = 1.0) -> bool:
    """检查该端口上是否已经跑着一个蓝笔申论实例。"""
    return _running_version(port, timeout) is not None


def _running_version(port: int, timeout: float = 1.0) -> str | None:
    """返回该端口上已有实例的版本号；不是本程序则返回 None。

    为什么要读版本号：**「已有一个实例在跑」不等于「可以直接复用」**。
    桌面版每次升级都跑在同一个默认端口上，用户升级后旧窗口往往还开着。
    早期这里只判断"是不是 BluePencil"，于是双击新版 exe 会命中旧实例、
    直接打开浏览器指向**旧版界面**然后自己退出 —— 用户看到的现象是
    「解压出来是旧版的」，而新版其实已经装好了。这个坑极隐蔽：日志一切正常。
    """
    try:
        import httpx

        res = httpx.get(f"http://127.0.0.1:{port}/api/v1/health", timeout=timeout)
        if res.status_code != 200:
            return None
        data = res.json()
        if "BluePencil" not in str(data.get("app", "")):
            return None
        return str(data.get("version") or "")
    except Exception:  # noqa: BLE001
        return None


def _open_browser_when_ready(port: int, version: str = "", delay: float = 0.0) -> None:
    """等端口真正可连上再开浏览器，避免打开时白屏。

    地址带上版本号（`/?v=0.13.2`）是刻意的：如果每次都开同一个地址，
    浏览器很可能**直接复用那个早就打开的标签页** —— 页面里的代码还是好几版之前的，
    新功能点了没反应，而"换新版"看起来毫无作用，因为那个页面根本收不到修复。
    URL 不同，浏览器就必须重新加载文档，拿到的一定是当前这一版的界面。
    """
    if delay:
        time.sleep(delay)
    url = f"http://127.0.0.1:{port}/" + (f"?v={version}" if version else "")
    for _ in range(60):  # 最多等 30 秒
        if _already_running(port):
            break
        time.sleep(0.5)
    webbrowser.open(url)


def _shutdown_on_page_close(server: uvicorn.Server) -> None:
    """把「浏览器页面全关完了」接到 uvicorn 的优雅退出上。

    为什么用 `server.should_exit` 而不是 `os._exit()`：前者会正常走完 lifespan
    的收尾（关掉 httpx 客户端、dispose 数据库连接池），后者是直接砍进程。
    桌面版是别人电脑上反复开关的程序，退得干净比退得快重要。

    为什么需要这个功能：用户关掉页面后普遍以为程序已经退出，但黑窗口还开着，
    下次双击就命中残留实例 —— 看着像"启动了"，其实什么也没重启。
    """
    print()
    print("  浏览器页面已全部关闭，程序即将退出…")
    server.should_exit = True


def _banner(port: int, version: str = "") -> None:
    line = "─" * 52
    # 地址带上版本号：与真正打开的那个 URL 保持一致。
    # 横幅里写着"手动复制上面的地址访问"——如果这里印的是不带版本号的地址，
    # 用户粘进浏览器就可能落回那个早就打开的旧标签页，正是我们要避免的情形。
    url = f"http://127.0.0.1:{port}/" + (f"?v={version}" if version else "")
    print()
    print(line)
    print("  蓝笔申论 BluePencil  ·  本地服务已启动")
    print(line)
    print(f"  版本     : v{version}" if version else "  版本     : —")
    print(f"  界面地址 : {url}")
    print(f"  接口文档 : http://127.0.0.1:{port}/docs")
    print()
    print("  浏览器会自动打开；若没弹出，手动复制上面的地址访问。")
    print("  关掉浏览器页面就会自动退出，也可以直接关掉本窗口。")
    print(line)
    print()


def main() -> None:
    _enable_utf8_console()

    # 必须在导入 settings 之前设：它决定 health 里报不报 desktop=True，
    # 前端据此才敢挂「关掉页面就结束进程」（网站版绝不能有这行为）
    os.environ.setdefault("DESKTOP_MODE", "1")

    # 延迟导入：让端口探测阶段保持轻量；这里只需要版本号
    from app.core.config import settings as app_settings

    current = app_settings.APP_VERSION

    # 已在跑的实例：**只有版本相同才复用**。
    # 版本不同就当作"旧窗口还开着"，另起一个端口，绝不把用户带去旧界面。
    running = _running_version(DEFAULT_PORT)
    if running is not None and running == current:
        print(f"检测到已在运行的实例 v{running}，直接打开浏览器：http://127.0.0.1:{DEFAULT_PORT}/?v={running}")
        webbrowser.open(f"http://127.0.0.1:{DEFAULT_PORT}/?v={running}")
        return

    port = _pick_port()

    if running is not None:
        # 这条提示很关键：用户升级后最常见的困惑就是"我明明换了新包，界面还是旧的"
        print(f"⚠️  端口 {DEFAULT_PORT} 上运行着**旧版本 v{running}**，当前程序是 v{current}。")
        print("    为避免打开旧界面，不复用该实例。")
        print(f"    新版本已改用：http://127.0.0.1:{port}/")
        print("    建议关掉那个旧版本窗口，避免两个版本同时开着。")
        print()

    # 延迟导入：端口探测阶段保持轻量，导入失败也能给出更干净的错误
    from app.main import app
    from app.core.config import WEB_DIR

    if WEB_DIR is None:
        print("⚠️  未找到前端构建产物，界面将无法访问（API 仍可用）。")
        print("    请先在 frontend/ 执行 npm run build 后重新打包。")

    _banner(port, current)

    if "--no-browser" not in sys.argv:
        threading.Thread(
            target=_open_browser_when_ready, args=(port, current), daemon=True
        ).start()

    # 用显式的 Server 对象（而不是 uvicorn.run 的语法糖）：
    # 关页即退需要能拿到 server 句柄、把 should_exit 置真，才能优雅退出。
    from app.services.session_watch import watch

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info"))
    watch.bind_exit(lambda: _shutdown_on_page_close(server))
    watch.start()

    try:
        server.run()
    except KeyboardInterrupt:
        pass
    print("  已退出。")


if __name__ == "__main__":
    main()
