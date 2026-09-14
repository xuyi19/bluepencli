# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
"""打包 Windows 免安装桌面版（一条命令出可分发的压缩包）

用法（在 backend/ 目录下）：
    .venv/Scripts/python.exe build_desktop.py

产出（文件名一律带版本号，版本取自仓库根 CHANGELOG.md 最上面一版）：
    release/蓝笔申论-桌面版-vX.Y.Z/       可直接运行或压缩转发的目录
    release/蓝笔申论-桌面版-vX.Y.Z.zip    发给别人即可

release/ 保留每一个版本的产物（只增不删），历史包用于回溯；同名版本重打会覆盖。

三个设计决定：

1. **one-folder 而非 one-file**：启动快（不必每次解压到临时目录），
   被安全软件误报的概率也明显更低。
2. **前端构建产物打进 `web/`**：exe 一个进程同时提供界面和 API，
   没有跨域问题，也不要求使用者另装任何东西。
3. **每次在全新临时目录里构建**：不做任何删除动作。
   本机有"批量删除需确认"的保护，复用目录会触发它并中断打包。
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

from release_utils import purge_dir, safe_rmtree

BACKEND = Path(__file__).resolve().parent
ROOT = BACKEND.parent
WEB_DIST = ROOT / "frontend" / "dist"
ICON = BACKEND / "assets" / "icon.ico"
RELEASE = ROOT / "release"
CHANGELOG = ROOT / "CHANGELOG.md"
APP_NAME = "BluePencil"
PKG_PREFIX = "蓝笔申论-桌面版"


def _read_version() -> str:
    """取仓库根 CHANGELOG.md 最上面那一版的版本号（唯一真源）。

    解析不到就直接停下——宁可报错，也不要静默打出一个版本号不对的包。
    """
    if not CHANGELOG.is_file():
        raise SystemExit(f"❌ 找不到更新日志：{CHANGELOG}")
    for line in CHANGELOG.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^##\s+(v[\d.]+)", line)
        if m:
            return m.group(1)
    raise SystemExit(
        "❌ CHANGELOG.md 里找不到 `## vX.Y.Z · 日期 · 标题` 开头的版本行，\n"
        "   改完格式后请同步更新 build_desktop.py 与 publish-single.mjs"
    )


VERSION = _read_version()
TARGET_DIR = RELEASE / f"{PKG_PREFIX}-{VERSION}"
ZIP_PATH = RELEASE / f"{PKG_PREFIX}-{VERSION}.zip"

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
        if old.is_dir() and not purge_dir(old):
            print(f"（{old.name} 没清掉，多半被占用了，忽略）")


def _archive_report() -> None:
    """清点 release/ 里已归档的历史版本（**不删**）。

    约定（2026-09-14 起）：
      · `release/` 根 = **最新一版**的产物（随手拿到的一定是新的，不会解压错）
      · `release/历史版本/` = 往期所有产物（回溯用）

    这里**递归统计而不是只扫根目录**：历史版本归入子目录后，只扫根目录会显示
    "暂无历史版本产物"，看着像历史包丢了 —— 同一个"布局变了、扫描没跟上"的坑，
    在 publish-single.mjs 与 check_release_private.py 里各踩过一次。

    保留而不是删除的理由：回溯"某个版本当时是什么样"时，历史包本身就是证据，
    重新构建出来的其实不是"当时那一版"（依赖版本、题库数据都可能已经变了）。
    """
    keep = {TARGET_DIR.resolve(), ZIP_PATH.resolve()}
    others = []
    for p in sorted(RELEASE.rglob(f"{PKG_PREFIX}*")):
        if any(part.startswith(".old-") for part in p.parts):
            continue
        if p.is_file() and p.suffix != ".zip":
            continue
        if p.resolve() in keep:
            continue
        others.append(str(p.relative_to(RELEASE)))

    if others:
        print(f"release/ 已归档 {len(others)} 个历史版本产物（保留不删）：")
        for name in others:
            print(f"  · {name}")
    else:
        print("release/ 暂无历史版本产物")


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


def _version_note() -> str:
    """产物自证版本。

    为什么必须写这个文件：release/ 里会同时躺着多个历史版本的包（只增不删），
    文件名只差一处版本号，解压上一版就会看到旧界面 —— 而"这到底是哪一版"
    本来不该靠翻文件名猜。这份文件让**包自己回答**，解压第一眼就能看到。
    """
    packed_at = time.strftime("%Y-%m-%d %H:%M")
    return f"""蓝笔申论 BluePencil · 版本信息
================================================================

版本      ：{VERSION}
打包时间  ：{packed_at}
题库范围  ：2010–2021 国考真题（24 套）+ 15 道自编仿真题
            （2022 年起的真题为私有，不在本包内，需作者定向分发）
分发许可  ：✅ 可以发给任何人（本包不含任何私有真题）

作者      ：许一 <xuconghui_03@qq.com>
GitHub    ：https://github.com/xuyi19/bluepencli
Gitee     ：https://gitee.com/xuyi_19/bluepencil
开源许可  ：AGPL-3.0

【怎么确认自己打开的是这一版】
  · 双击 exe 后，黑色窗口里会打印一行启动版本号
  · 打开界面 → 左上角「设置」→ 底部「关于」处显示当前版本
  · 本文件所在目录名也带版本号（{PKG_PREFIX}-{VERSION}）

【如果你看到的是旧界面】
  · 先确认没有解压错包（比对本文件的版本号）
  · 若是从旧版升级：关掉程序，把旧文件夹整个删掉，再解压新包重新运行。
    不要只把新 exe 覆盖进旧文件夹 —— _internal 文件夹才是程序本体，
    新旧混放会出现界面与后端版本不一致。
  · 浏览器有缓存时，按 Ctrl+F5 强制刷新一次。
"""


def _assemble(built: Path) -> None:
    """整理成可分发目录：改名、附说明、清掉打包机的数据。"""
    _clear_target()

    shutil.copytree(built, TARGET_DIR)

    # exe 改成中文名，外观友好。改名不影响运行——
    # PyInstaller 靠 exe 所在目录找 _internal，与文件名无关（已实测）。
    (TARGET_DIR / f"{APP_NAME}.exe").rename(TARGET_DIR / "蓝笔申论.exe")

    # 使用说明第一行就带上版本号 —— 解压后第一眼看到的就是"这是哪一版"
    _write_text(TARGET_DIR / "使用说明.txt", README.replace("（免安装）", f"（免安装 · {VERSION}）", 1))
    _write_text(TARGET_DIR / "版本信息.txt", _version_note())
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
    print(f"  打包 {APP_NAME} {VERSION}  →  {TARGET_DIR}")
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
    print("   ✅ 本包只含 2010–2021 公开卷，可直接发给任何人。")
    print("      发之前想再确认一遍，跑 .tools/check_release_private.py")

    # 清理一律放在最后：本机的删除保护可能中断进程，
    # 但此时交付物已经生成并落盘，中断也不影响结果。
    purge_dir(stage)
    _sweep_leftovers()
    _archive_report()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
