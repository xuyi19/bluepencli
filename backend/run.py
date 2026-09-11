"""本地启动后端：python run.py

等价于：uvicorn app.main:app --reload --port 8100

为什么不用默认的 8000？
    本机上 8000 常被另一个项目 resumatch-ai 占用。两个项目同时开发时，
    后启动的那个会静默 bind 失败，而前端代理照常工作 —— 于是请求全被
    打到另一个项目上，症状看着像"代码 bug"。所以蓝笔申论固定用 8100，
    前端 vite 的 /api 代理也指向这里（见 frontend/vite.config.js）。

想临时换端口：
    set BLUEPENCIL_PORT=8200 && python run.py

启动前会做两项自检，把两个最常见的坑直接说清楚：
    1) 解释器选错（用了 Anaconda 等外部环境，缺 fastapi/sqlalchemy）
    2) 端口被占（上一次的后端没退干净，或别的程序占着）
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import urllib.request
from pathlib import Path

HOST = "127.0.0.1"
PORT = int(os.environ.get("BLUEPENCIL_PORT", "8100"))

# 用来认领"这是不是自己的进程"：/api/v1/health 的 app 字段含这个名字
APP_MARK = "BluePencil"
REQUIRED_MODULES = ("fastapi", "sqlalchemy", "uvicorn")
VENV_PYTHON = Path(__file__).resolve().parent / ".venv" / "Scripts" / "python.exe"


def _fail(msg: str) -> None:
    print("\n" + msg + "\n", file=sys.stderr)
    raise SystemExit(1)


def _check_deps() -> None:
    """解释器选错了会在这里就被拦下，而不是等 uvicorn 抛 ModuleNotFoundError。"""
    missing = []
    for mod in REQUIRED_MODULES:
        try:
            __import__(mod)
        except ImportError:
            missing.append(mod)
    if not missing:
        return

    lines = [
        "✗ 当前 Python 环境缺少依赖：" + ", ".join(missing),
        "  正在用的解释器：" + sys.executable,
    ]
    if VENV_PYTHON.exists():
        lines += [
            "",
            "  项目自带的虚拟环境（应该用这个）：",
            "    " + str(VENV_PYTHON),
            "",
            "  PyCharm 改法：Settings → Project: bluepencil → Python Interpreter",
            "  → Add Interpreter → Existing → 选上面那个 python.exe",
        ]
    else:
        lines += ["", "  本机还没有 .venv，先在 backend 目录执行：", "    python -m venv .venv"]
    _fail("\n".join(lines))


def _port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((HOST, port))
            return True
        except OSError:
            return False


def _health_of(port: int) -> str:
    """能连上就直接问一句是谁；连不上或不是我们的接口就返回空串。"""
    try:
        with urllib.request.urlopen(
            "http://%s:%d/api/v1/health" % (HOST, port), timeout=1.5
        ) as resp:
            return str(json.loads(resp.read().decode("utf-8")).get("app", ""))
    except Exception:
        return ""


def _pid_holding(port: int) -> str:
    """Windows 上查一下谁占着端口，只为了把报错信息说人话。

    注意：netstat 在中文 Windows 上输出 GBK，而 Python 的控制台编码可能是
    UTF-8。这里按字节取回、自己容错解码，避免解码失败把 stdout 变成 None。
    """
    try:
        proc = subprocess.run(["netstat", "-ano"], capture_output=True, timeout=5)
    except Exception:
        return ""

    raw = proc.stdout or b""
    if not isinstance(raw, bytes):  # 理论上不会，保险起见
        raw = str(raw).encode("utf-8", errors="replace")
    for enc in ("gbk", "utf-8"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("utf-8", errors="replace")

    for line in text.splitlines():
        parts = line.split()
        if (
            len(parts) >= 5
            and parts[0].upper() == "TCP"
            and parts[1].endswith(":%d" % port)
            and parts[3].upper() == "LISTENING"
        ):
            return parts[4]
    return ""


def _check_port() -> None:
    if _port_is_free(PORT):
        return

    if APP_MARK in _health_of(PORT):
        pid = _pid_holding(PORT)
        print("后端已经在跑了，不用重复启动：http://%s:%d" % (HOST, PORT))
        print("接口文档：http://%s:%d/docs" % (HOST, PORT))
        if pid:
            print("想换成你自己启动的实例，先结束它：taskkill /F /PID %s" % pid)
        raise SystemExit(0)

    pid = _pid_holding(PORT)
    lines = ["✗ 端口 %d 被占用，而且占用者不是蓝笔申论的后端。" % PORT]
    if pid:
        lines += [
            "  占用进程 PID=" + pid,
            "  看看它是什么：  tasklist /FI \"PID eq %s\"" % pid,
            "  确认没用就结束它：taskkill /F /PID %s" % pid,
        ]
    else:
        lines.append("  自己查一下：    netstat -ano | findstr :%d" % PORT)
    lines.append("")
    lines.append("  或者换个端口启动：set BLUEPENCIL_PORT=8200 && python run.py")
    _fail("\n".join(lines))


def main() -> None:
    _check_deps()
    _check_port()

    import uvicorn

    print("蓝笔申论后端启动中 → http://%s:%d   (文档 /docs)" % (HOST, PORT))
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=True)


if __name__ == "__main__":
    main()
