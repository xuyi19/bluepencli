# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
"""给 release/ 里的每个产物做一次体检：**是哪一版？含不含私有卷？**

为什么不能凭印象：
    私有卷（2022 年起国考）有一条硬规则 —— **不随任何产物分发**。
    但"这一版是分层之前打的"这种事靠记忆判断，迟早出错。
    v0.4.0 / v0.5.0 就是分层之前打的，混在归档里，光看文件名看不出来。
    所以每次发版前跑一遍这个脚本，让文件自己说话。

为什么必须递归子目录：
    历史版本被归入 `release/桌面版/历史版本/` 之后，只扫根目录会让它们
    **彻底逃过检查** —— 那比不检查更危险（以为查过了）。
    所以这里 rglob 到底。

判据（两条都要过）：
    1. 数 `exam-*.js` chunk：公开版应当是 24 个（2010–2021 各两套）
    2. 数 `exam-202[2-4]*` chunk：**必须是 0**

用法：
    backend/.venv/Scripts/python.exe .tools/check_release_private.py
    backend/.venv/Scripts/python.exe .tools/check_release_private.py --dir release
"""
from __future__ import annotations

import argparse
import io
import re
import sys
import zipfile
from pathlib import Path

# 私有卷的年份。改分层策略时只改这里。
PRIVATE_YEARS = ("2022", "2023", "2024")
# 公开卷数从 exams_config 动态算：河北等省考卷 ≤2021 也进公开区（2026-09-23 起），
# 手写死数每次加卷都要改，且忘了改就会把合法发布误报成泄密 —— 让清单自己回答。
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'exams'))
from exams_config import EXAMS as _EXAMS  # noqa: E402
PUBLIC_CHUNK_TOTAL = sum(1 for _s in _EXAMS if _s['year'] <= 2021 and not _s.get('skip'))

ROOT = Path(__file__).resolve().parent.parent

# 各版本的功能指纹。用于回答"这个包到底是哪一版"——
# 文件名可以改名，但产物里的界面代码改不了。
VERSION_MARKS = [
    ("微信入口", ("加微信", "交流群")),
    ("采分点面板", ("采分点对照",)),
    ("bpq 导入", ("导入题库包",)),
    # v0.10.0：加密签名包（BPQ00002）—— 认不出这个说明前端是 v0.9.0 及更早
    ("bpq 加密包", ("BPQ00002",)),
    # v0.9.0 起前端带会话登记代码（注意：这段代码在网站版/单文件版里也存在，
    # 只是运行时按 desktop=true 才生效，所以它只作"版本 ≥ v0.9.0"的标记，
    # 不代表这个产物本身会关页即退——那是桌面版的 exe 才有的行为）
    ("会话登记≥v0.9", ("session/bye",)),
]


def classify(names: list[str]) -> tuple[int, list[str]]:
    """从一堆文件名里挑出 exam chunk，并分出私有卷。"""
    exams = [n for n in names if "exam-" in n and n.endswith(".js")]
    priv = [n for n in exams if any(y in n for y in PRIVATE_YEARS)]
    return len(exams), priv


def _features_from_bundle(text: str) -> list[str]:
    return [label for label, keys in VERSION_MARKS if any(k in text for k in keys)]


def check_zip(path: Path) -> tuple[int, list[str], list[str]] | None:
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            n, priv = classify(names)
            # 读入口 bundle 判断版本指纹（网站版/桌面版都是 assets/index-*.js）
            bundles = [x for x in names if re.search(r"assets/index-[^/]+\.js$", x)]
            feats = []
            if bundles:
                feats = _features_from_bundle(z.read(bundles[0]).decode("utf-8", "ignore"))
            return n, priv, feats
    except (zipfile.BadZipFile, OSError) as e:
        print(f"  ⚠️ 读不了：{e.__class__.__name__} {e}")
        return None


def check_dir(path: Path) -> tuple[int, list[str], list[str]]:
    names = [f.name for f in path.rglob("exam-*.js")]
    priv = [n for n in names if any(y in n for y in PRIVATE_YEARS)]
    bundles = list(path.rglob("assets/index-*.js"))
    feats = []
    if bundles:
        feats = _features_from_bundle(
            io.open(bundles[0], encoding="utf-8", errors="ignore").read()
        )
    return len(names), priv, feats


def check_html(path: Path) -> tuple[bool, list[str]]:
    """单文件版是内联的，没有 chunk 文件可数，只能搜特征串。"""
    text = io.open(path, encoding="utf-8", errors="ignore").read()
    hit = [y for y in PRIVATE_YEARS if f"exam-{y}" in text]
    feats = _features_from_bundle(text)
    version = ""
    m = re.search(r'<meta name="app-version-tag" content="(v[\d.]+)"', text)
    if m:
        version = m.group(1)
    return bool(hit), feats, version


def _iter_artifacts(target: Path):
    """按「归档单元」遍历，刻意递归到底。

    归档单元 = zip / 目录形式的发布物（含 _internal）/ 单文件版 HTML。
    目录内部的零散文件不单独成项，只跟着它的发布目录一起体检。
    """
    for p in sorted(target.rglob("*")):
        if any(part in ("私有题库", "_internal", "web", "assets") for part in p.parts):
            continue
        if p.suffix == ".zip":
            yield p
        elif p.suffix == ".html":
            yield p
        elif p.is_dir() and (p / "_internal").is_dir():
            yield p


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="release", help="归档目录（默认 release）")
    args = ap.parse_args()

    target = ROOT / args.dir
    if not target.is_dir():
        print(f"❌ 找不到目录：{target}")
        return 1

    print(f"体检目录：{target}（含子目录）\n")

    leaked: list[str] = []
    checked = 0
    for path in _iter_artifacts(target):
        rel = path.relative_to(target)
        if path.suffix == ".zip":
            r = check_zip(path)
            kind = "压缩包"
        elif path.suffix == ".html":
            r = check_html(path)
            kind = "单文件版"
        else:
            r = check_dir(path)
            kind = "目录"

        if r is None:
            continue
        checked += 1

        if kind == "单文件版":
            hit, feats, version = r
            print(f"─ {rel}  [{kind}]  {version or '（无版本标记）'}")
            print(f"    {'🔒 命中私有卷 chunk 名' if hit else '✅ 未见私有卷'}"
                  f"｜功能：{'、'.join(feats) or '（早期版本）'}")
            if hit:
                leaked.append(str(rel))
            continue

        n, priv, feats = r
        flag = "🔒 含私有卷" if priv else "✅ 仅公开卷"
        print(f"─ {rel}  [{kind}]")
        print(f"    exam chunk {n} 个（公开版应为 {PUBLIC_CHUNK_TOTAL}）｜{flag}")
        print(f"    功能：{'、'.join(feats) or '（早期版本，尚未接入评分内核/微信）'}")
        if priv:
            print(f"    私有：{', '.join(sorted(set(priv))[:4])}")
            leaked.append(str(rel))

    print("\n" + "=" * 60)
    if leaked:
        print("⚠️ 以下产物含私有卷，**不能对外分发**：")
        for n in leaked:
            print(f"  · {n}")
        print("\n分层之前打的包属于此类。要么删除，要么明确标记为『仅自用』。")
        return 2

    print(f"✅ {checked} 个归档产物全部只含公开卷，均可对外分发。")
    print("   提示：功能字段可用来核对「这个包是不是最新版」——")
    print("   最新版应当同时含『微信入口』『采分点面板』『bpq 导入』"
          "『bpq 加密包』『会话登记≥v0.9』。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
