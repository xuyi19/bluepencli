"""把 assets/icon.svg 转成 Windows 用的 assets/icon.ico

用系统自带的 Chrome/Edge 无头模式渲染 SVG（本机没有装任何图形库，
这样零额外依赖），再把 PNG 打包进 ICO 容器。

用法（在 backend/ 目录下）：
    .venv/Scripts/python.exe make_icon.py
"""

import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
SVG = BACKEND / "assets" / "icon.svg"
ICO = BACKEND / "assets" / "icon.ico"

SIZES = [256, 128, 64, 48, 32, 16]

BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def _find_browser() -> str:
    for path in BROWSERS:
        if Path(path).is_file():
            return path
    found = shutil.which("chrome") or shutil.which("msedge")
    if found:
        return found
    raise SystemExit("❌ 没找到 Chrome 或 Edge，无法渲染图标")


def _render(browser: str, size: int, out_png: Path) -> None:
    """把 SVG 渲染成指定尺寸的透明 PNG。"""
    html = (
        "<html><head><meta charset='utf-8'><style>"
        "html,body{margin:0;padding:0;overflow:hidden;background:transparent}"
        f"img{{display:block;width:{size}px;height:{size}px}}"
        "</style></head><body>"
        f"<img src='file:///{SVG.as_posix()}'>"
        "</body></html>"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as f:
        f.write(html)
        tmp_html = Path(f.name)

    try:
        subprocess.run(
            [
                browser,
                "--headless=new",
                "--disable-gpu",
                "--no-sandbox",
                "--hide-scrollbars",
                "--default-background-color=00000000",
                f"--screenshot={out_png}",
                f"--window-size={size},{size}",
                tmp_html.as_uri(),
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )
    finally:
        tmp_html.unlink(missing_ok=True)


def _png_size(png: bytes) -> tuple[int, int]:
    """从 PNG 的 IHDR 里读出宽高（第 16..24 字节）。"""
    if png[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("不是合法的 PNG")
    width, height = struct.unpack(">II", png[16:24])
    return width, height


def _pack_ico(pngs: list[bytes]) -> bytes:
    """把若干 PNG 打包成 ICO（Vista 起支持 PNG 载荷）。"""
    count = len(pngs)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count

    entries = b""
    for png in pngs:
        w, h = _png_size(png)
        entries += struct.pack(
            "<BBBBHHII",
            w % 256,  # 256 要写成 0
            h % 256,
            0,  # 调色板数
            0,  # 保留
            1,  # 色彩平面
            32,  # 位深
            len(png),
            offset,
        )
        offset += len(png)

    return header + entries + b"".join(pngs)


def main() -> int:
    if not SVG.is_file():
        raise SystemExit(f"❌ 未找到 {SVG}")

    browser = _find_browser()
    print(f"用浏览器渲染：{browser}")

    tmp_dir = Path(tempfile.mkdtemp(prefix="bluepencil-icon-"))
    pngs: list[bytes] = []
    try:
        for size in SIZES:
            out = tmp_dir / f"icon-{size}.png"
            _render(browser, size, out)
            data = out.read_bytes()
            w, h = _png_size(data)
            if (w, h) != (size, size):
                print(f"  ⚠️ {size}px 实际渲染为 {w}x{h}")
            pngs.append(data)
            print(f"  ✅ 渲染 {size}x{size}  ({len(data) / 1024:.1f} KB)")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    ICO.write_bytes(_pack_ico(pngs))
    print(f"\n✅ 图标已生成：{ICO}  ({ICO.stat().st_size / 1024:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
