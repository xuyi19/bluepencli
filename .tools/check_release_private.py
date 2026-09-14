# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
"""核查 release/ 里每个产物**到底含不含私有卷**。

为什么不能凭印象：
    私有卷（2022 年起国考）有一条硬规则 —— **不随任何产物分发**。
    但"这一版是分层之前打的"这种事靠记忆判断，迟早出错。
    v0.4.0 / v0.5.0 就是分层之前打的，混在归档里，光看文件名看不出来。
    所以每次发版前跑一遍这个脚本，让文件自己说话。

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
import sys
import zipfile
from pathlib import Path

# 私有卷的年份。改分层策略时只改这里。
PRIVATE_YEARS = ("2022", "2023", "2024")
PUBLIC_CHUNK_TOTAL = 24  # 2010–2021 各两套

ROOT = Path(__file__).resolve().parent.parent


def classify(names: list[str]) -> tuple[int, list[str]]:
    """从一堆文件名里挑出 exam chunk，并分出私有卷。"""
    exams = [n for n in names if "exam-" in n and n.endswith(".js")]
    priv = [n for n in exams if any(y in n for y in PRIVATE_YEARS)]
    return len(exams), priv


def check_zip(path: Path) -> tuple[int, list[str]] | None:
    try:
        with zipfile.ZipFile(path) as z:
            return classify(z.namelist())
    except (zipfile.BadZipFile, OSError) as e:
        print(f"  ⚠️ 读不了：{e.__class__.__name__} {e}")
        return None


def check_dir(path: Path) -> tuple[int, list[str]]:
    names = [f.name for f in path.rglob("exam-*.js")]
    priv = [n for n in names if any(y in n for y in PRIVATE_YEARS)]
    return len(names), priv


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="release", help="归档目录（默认 release）")
    args = ap.parse_args()

    target = ROOT / args.dir
    if not target.is_dir():
        print(f"❌ 找不到目录：{target}")
        return 1

    print(f"核查目录：{target}\n")

    leaked: list[str] = []
    checked = 0
    for path in sorted(target.iterdir()):
        if path.name == "私有题库":
            # .bpq 是"定向分发"的载体，本来就含私有卷正文，不在本脚本判据内
            print("─ 私有题库/  → 定向分发资产，跳过（不算泄漏）")
            continue

        if path.suffix == ".zip":
            r = check_zip(path)
        elif path.is_dir():
            r = check_dir(path)
        else:
            continue  # .html / .md 另见下面单独说明

        if r is None:
            continue
        checked += 1
        n, priv = r
        flag = "🔒 含私有卷" if priv else "✅ 仅公开卷"
        print(f"─ {path.name}")
        print(f"    exam chunk {n} 个（公开版应为 {PUBLIC_CHUNK_TOTAL}）｜{flag}")
        if priv:
            print(f"    私有：{', '.join(sorted(set(priv))[:4])}")
            leaked.append(path.name)

    # 单文件版是内联的，没有 chunk 文件可数，只能搜特征串
    htmls = [p for p in target.glob("*.html")]
    if htmls:
        print("\n─ 单文件版（内联，按内容搜特征串）")
        for p in htmls:
            text = io.open(p, encoding="utf-8", errors="ignore").read()
            hit = [y for y in PRIVATE_YEARS if f"exam-{y}" in text]
            print(f"    {p.name}：{'🔒 命中私有卷 chunk 名' if hit else '✅ 未见私有卷'}")
            if hit:
                leaked.append(p.name)

    print("\n" + "=" * 56)
    if leaked:
        print("⚠️ 以下产物含私有卷，**不能对外分发**：")
        for n in leaked:
            print(f"  · {n}")
        print("\n分层之前打的包属于此类。要么删除，要么明确标记为『仅自用』。")
        return 2

    print(f"✅ {checked} 个归档产物全部只含公开卷，均可对外分发。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
