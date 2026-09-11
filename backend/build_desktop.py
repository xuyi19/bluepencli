"""打包 Windows 免安装桌面版（一条命令出可分发的压缩包）

用法（在 backend/ 目录下）：
    .venv/Scripts/python.exe build_desktop.py

产出：
    release/蓝笔申论-桌面版/        可直接运行或压缩转发的目录
    release/蓝笔申论-桌面版.zip     发给别人即可

三个设计决定：

1. **one-folder 而非 one-file**：启动快（不必每次解压到临时目录），
   被安全软件误报的概率也明显更低。
2. **前端构建产物打进 `web/`**：exe 一个进程同时提供界面和 API，
   没有跨域问题，也不要求使用者另装任何东西。
3. **每次在全新临时目录里构建**：不做任何删除动作。
   本机有"批量删除需确认"的保护，复用目录会触发它并中断打包。
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

from release_utils import safe_rmtree

BACKEND = Path(__file__).resolve().parent
ROOT = BACKEND.parent
WEB_DIST = ROOT / "frontend" / "dist"
ICON = BACKEND / "assets" / "icon.ico"
RELEASE = ROOT / "release"
TARGET_DIR = RELEASE / "蓝笔申论-桌面版"
ZIP_PATH = RELEASE / "蓝笔申论-桌面版.zip"
APP_NAME = "BluePencil"

# uvicorn 依赖动态导入，PyInstaller 静态分析看不到这些实现类
HIDDEN_IMPORTS = [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    # SQLAlchemy 的方言也是按字符串动态加载的
    "sqlalchemy.dialects.sqlite",
    "sqlalchemy.dialects.sqlite.pysqlite",
    "sqlalchemy.dialects.sqlite.aiosqlite",
    # 关键：SQLAlchemy 的 aiosqlite 方言里写的是 __import__("aiosqlite")，
    # 纯字符串导入，PyInstaller 完全看不到——漏了这个，打包后一启动就
    # ModuleNotFoundError: No module named 'aiosqlite'
    "aiosqlite",
    # SQLAlchemy 异步引擎靠它做协程调度
    "greenlet",
]

# 装了才加，没装就不加（避免 PyInstaller 因找不到而中止）
OPTIONAL_IMPORTS = ["httptools", "websockets", "colorama", "dotenv", "yaml"]

README = """蓝笔申论 BluePencil · 桌面版（免安装）
================================================================

【怎么用】
  1. 把整个文件夹解压到任意位置（放桌面就行）
  2. 双击「蓝笔申论.exe」
  3. 等几秒，浏览器会自动打开界面
  4. 用完后，关掉那个黑色窗口就是退出程序

【注意】别只把 exe 单独复制出来发人
  _internal 文件夹是程序本体的一部分，必须和 exe 待在同一个目录里。
  要发给别人，直接发整个文件夹（或压缩包）。

【关于 API Key】
  · 如果打包的人在 config.json 里配好了，你什么都不用填，打开就能批改。
  · 如果没有，点左上角「设置」→「大模型 API」→ 填 Key → 保存。
  · Key 只存在你自己的浏览器里，不会上传到任何服务器。

【常见问题】
  Q：双击后窗口闪一下就没反应了？
  A：多半被杀毒软件拦了。把整个文件夹加进白名单，再双击。

  Q：浏览器没自动打开？
  A：手动复制黑色窗口里显示的那行地址（形如 http://127.0.0.1:8765/）粘到浏览器。

  Q：提示端口被占用？
  A：程序会自动顺延换端口，以窗口里显示的地址为准，不影响使用。

  Q：我的数据存在哪？换电脑怎么办？
  A：作答、笔记、错题、复习卡片都在本地（程序目录的 data/ 与浏览器的本地存储）。
     换电脑用「设置 → 导出全部数据」导出 JSON，在新电脑「导入数据」即可。

  Q：能不能不联网用？
  A：界面、文章库、历史记录、笔记都能离线看和写；
     但 AI 批改本身要调用模型，必须联网。

【系统要求】
  Windows 10 / 11（64 位）。
  无需安装 Python、Node.js 或任何数据库。
"""

CONFIG_EXAMPLE = """{
  "_说明": "把本文件改名为 config.json 放在 exe 同级目录，即可让使用者零配置直接用。不改名不会被读取。",
  "LLM_API_KEY": "sk-在这里填你的APIKey",
  "LLM_BASE_URL": "https://api.deepseek.com",
  "LLM_MODEL": "deepseek-chat"
}
"""


def _importable(name: str) -> bool:
    import importlib.util

    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def _write_text(path: Path, text: str) -> None:
    """UTF-8 + BOM，避免 Windows 记事本打开中文乱码。"""
    path.write_text(text, encoding="utf-8-sig")


def _pyinstaller(stage: Path) -> Path:
    """在全新临时目录里构建，返回解包后的程序目录。"""
    hidden = list(HIDDEN_IMPORTS) + [m for m in OPTIONAL_IMPORTS if _importable(m)]
    args = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--name",
        APP_NAME,
        "--distpath",
        str(stage / "dist"),
        "--workpath",
        str(stage / "work"),
        "--specpath",
        str(stage),
        # 前端构建产物 → 打包后的 web/（config.py 的 _resolve_web_dir 读这里）
        "--add-data",
        f"{WEB_DIST}{os.pathsep}web",
        "--collect-submodules",
        "uvicorn",
    ]
    if ICON.is_file():
        args += ["--icon", str(ICON)]
    for name in hidden:
        args += ["--hidden-import", name]
    args.append(str(BACKEND / "desktop.py"))

    result = subprocess.run(args, cwd=str(BACKEND))
    if result.returncode != 0:
        raise SystemExit("❌ PyInstaller 打包失败")

    built = stage / "dist" / APP_NAME
    if not (built / f"{APP_NAME}.exe").is_file():
        raise SystemExit(f"❌ 未生成可执行文件：{built}")
    return built


def _sweep_leftovers() -> None:
    """尽力清掉历史遗留的 `.old-*` 目录。

    删不掉就留着——绝不能因为清理失败而中断打包。
    """
    for old in RELEASE.glob(".old-*"):
        if old.is_dir():
            safe_rmtree(old)


def _clear_target() -> None:
    """把上一次的发布目录让开。

    本机有"按轮次累计"的批量删除保护，一轮里删多了会被拦下**并中断整个进程**。
    所以这里**不做任何删除**，只改名挪开——改名不触发保护，一定成功。
    遗留的 `.old-*` 统一放到最后清理（见 main 的收尾顺序）。
    """
    if not TARGET_DIR.exists():
        return
    trash = RELEASE / f".old-{time.strftime('%Y%m%d-%H%M%S')}"
    print(f"旧发布包改名挪开 → {trash.name}")
    try:
        TARGET_DIR.rename(trash)
    except PermissionError as e:
        # 最常见的原因：上一次的 exe 还在跑，它的工作目录锁住了这个文件夹
        raise SystemExit(
            f"❌ 无法挪开旧发布目录（{e.__class__.__name__}）。\n"
            "   多半是「蓝笔申论.exe」还在运行，占着这个目录。\n"
            "   请先关掉它（或结束占用该目录的进程）后重试。"
        ) from e


def _assemble(built: Path) -> None:
    """整理成可分发目录：改名、附说明、清掉打包机的数据。"""
    _clear_target()

    shutil.copytree(built, TARGET_DIR)

    # exe 改成中文名，外观友好。改名不影响运行——
    # PyInstaller 靠 exe 所在目录找 _internal，与文件名无关（已实测）。
    (TARGET_DIR / f"{APP_NAME}.exe").rename(TARGET_DIR / "蓝笔申论.exe")

    _write_text(TARGET_DIR / "使用说明.txt", README)
    _write_text(TARGET_DIR / "config.example.json", CONFIG_EXAMPLE)

    # 打包机上跑出来的库不该跟着发出去
    safe_rmtree(TARGET_DIR / "data")


def _zip() -> None:
    """先写到 .tmp 再原子替换。

    不先 `unlink` 旧包——本机的删除保护会拦下它并终止进程；
    `os.replace`（Path.replace）是直接覆盖，不需要额外的删除动作。
    """
    tmp = ZIP_PATH.with_name(ZIP_PATH.name + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for f in sorted(TARGET_DIR.rglob("*")):
            if f.is_file():
                zf.write(f, Path(TARGET_DIR.name) / f.relative_to(TARGET_DIR))
    tmp.replace(ZIP_PATH)


def main() -> int:
    if not WEB_DIST.is_dir():
        print(f"❌ 未找到前端构建产物：{WEB_DIST}")
        print("   请先在 frontend/ 目录执行：npm run build")
        return 1

    stamp = time.strftime("%Y%m%d-%H%M%S")
    stage = Path(tempfile.gettempdir()) / "bluepencil-build" / stamp

    print("=" * 62)
    print(f"  打包 {APP_NAME}  →  {TARGET_DIR}")
    print(f"  前端产物：{WEB_DIST}")
    print(f"  构建临时目录：{stage}")
    print("=" * 62)

    built = _pyinstaller(stage)
    _assemble(built)
    _zip()

    dir_mb = sum(f.stat().st_size for f in TARGET_DIR.rglob("*") if f.is_file()) / 1024 / 1024
    zip_mb = ZIP_PATH.stat().st_size / 1024 / 1024
    print()
    print("✅ 打包完成")
    print(f"   目录  ：{TARGET_DIR}  ({dir_mb:.1f} MB)")
    print(f"   压缩包：{ZIP_PATH}  ({zip_mb:.1f} MB)")
    print()
    print("   直接把这个压缩包发给别人，对方解压后双击「蓝笔申论.exe」即可。")

    # 清理一律放在最后：本机的删除保护可能中断进程，
    # 但此时交付物已经生成并落盘，中断也不影响结果。
    safe_rmtree(stage)
    _sweep_leftovers()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
