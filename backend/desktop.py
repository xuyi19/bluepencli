"""蓝笔申论 · 桌面版启动器

双击 exe（或 `python desktop.py`）后：
  1. 找端口起本地服务（界面 + API 同一个进程，无跨域）
  2. 自动打开默认浏览器
  3. 控制台保留日志，关闭窗口即退出

设计要点：
- 复用已运行的实例。重复双击不会启第二份服务，直接开浏览器指向已在跑的那个。
- 端口冲突自动顺延，不需要用户改配置。
- 传 app 对象给 uvicorn（而不是 "app.main:app" 字符串），避免打包后动态导入失败。
"""

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
    try:
        import httpx

        res = httpx.get(f"http://127.0.0.1:{port}/api/v1/health", timeout=timeout)
        return res.status_code == 200 and "BluePencil" in res.text
    except Exception:  # noqa: BLE001
        return False


def _open_browser_when_ready(port: int, delay: float = 0.0) -> None:
    """等端口真正可连上再开浏览器，避免打开时白屏。"""
    if delay:
        time.sleep(delay)
    url = f"http://127.0.0.1:{port}/"
    for _ in range(60):  # 最多等 30 秒
        if _already_running(port):
            break
        time.sleep(0.5)
    webbrowser.open(url)


def _banner(port: int) -> None:
    line = "─" * 52
    print()
    print(line)
    print("  蓝笔申论 BluePencil  ·  本地服务已启动")
    print(line)
    print(f"  界面地址 : http://127.0.0.1:{port}/")
    print(f"  接口文档 : http://127.0.0.1:{port}/docs")
    print()
    print("  浏览器会自动打开；若没弹出，手动复制上面的地址访问。")
    print("  关闭本窗口即退出程序。")
    print(line)
    print()


def main() -> None:
    _enable_utf8_console()

    # 已在跑就直接复用，不启第二份
    if _already_running(DEFAULT_PORT):
        print(f"检测到已在运行的实例，直接打开浏览器：http://127.0.0.1:{DEFAULT_PORT}/")
        webbrowser.open(f"http://127.0.0.1:{DEFAULT_PORT}/")
        return

    port = _pick_port()

    # 延迟导入：让端口探测阶段保持轻量，失败也能给出更干净的错误
    from app.main import app
    from app.core.config import WEB_DIR

    if WEB_DIR is None:
        print("⚠️  未找到前端构建产物，界面将无法访问（API 仍可用）。")
        print("    请先在 frontend/ 执行 npm run build 后重新打包。")

    _banner(port)

    if "--no-browser" not in sys.argv:
        threading.Thread(target=_open_browser_when_ready, args=(port,), daemon=True).start()

    try:
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
