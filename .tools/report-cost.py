# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
"""真实批改的成本与 Token 实测报告。

为什么要它：项目从 v0.1.0 起所有验证都在代码层与接口层跑，「一次真实批改要花
多少钱、耗多少 token」这件事一直没实测过 —— 牌面上只有预估（三师 ¥0.12 / 五师
¥0.22，常规模式单题 ≤ 2500 token）。跑完第一次真 Key 之后用这个脚本把数字拿出来。

用法：
    backend/.venv/Scripts/python.exe .tools/report-cost.py            # 自动找最近写入的库
    backend/.venv/Scripts/python.exe .tools/report-cost.py <db 路径>  # 指定

数据来源：后端 SQLite（grading_tasks 汇总 + llm_call_logs 逐次明细）。
⚠️ 前端填自己的 Key 时，请求仍经后端转发（chatBackend），所以一样会被记账；
只有后端没起来、走浏览器直连的那次不会被记 —— 报告里会出现「0 次调用」，
那不是没花钱，是没记账。
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 与 backend/app/services/grading_service.py 保持一致（DeepSeek 价目：输入 ¥2/M、输出 ¥8/M）
PRICE_PROMPT_PER_M = 2.0
PRICE_COMPLETION_PER_M = 8.0

# 验收线：方案里定的目标
TOKEN_BUDGET = 2500          # 常规模式单题
COST_TARGET = {"solo": 0.03, "duo": 0.08, "roundtable": 0.22}


def disp_len(s: str) -> int:
    """按显示宽度计长度（中日韩字符占 2 格）"""
    return sum(2 if ord(c) > 0x2E80 else 1 for c in s)


def pad(s: str, width: int) -> str:
    return s + " " * max(0, width - disp_len(s))


def candidates() -> list[Path]:
    """所有可能放着数据库的位置，按最后写入时间倒序"""
    found: list[Path] = []
    found.append(ROOT / "backend" / "data" / "bluepencil.db")
    release = ROOT / "release"
    if release.is_dir():
        for child in release.iterdir():
            if child.is_dir() and (child / "data" / "bluepencil.db").exists():
                found.append(child / "data" / "bluepencil.db")
    return sorted([p for p in found if p.exists()], key=lambda p: p.stat().st_mtime, reverse=True)


def money(prompt_tokens: int, completion_tokens: int) -> float:
    return (prompt_tokens / 1_000_000) * PRICE_PROMPT_PER_M + (
        completion_tokens / 1_000_000
    ) * PRICE_COMPLETION_PER_M


def rows(cur: sqlite3.Cursor, sql: str, args: tuple = ()) -> list[tuple]:
    try:
        return cur.execute(sql, args).fetchall()
    except sqlite3.OperationalError as e:
        print(f"  （查不动：{e}）")
        return []


def report(db: Path) -> int:
    db = db.resolve()          # 传进来的可能是相对路径，relative_to 要求两边都已解析
    mtime = datetime.fromtimestamp(db.stat().st_mtime).strftime("%m-%d %H:%M:%S")
    print(f"\n数据库：{db.relative_to(ROOT)}  （最后写入 {mtime}）")

    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    cur = conn.cursor()

    tasks = rows(
        cur,
        """SELECT task_id, mode, teacher_ids, question_type, title, answer_chars, deep,
                  final_score, max_score, score_rate, elapsed_ms, llm_calls,
                  prompt_tokens, completion_tokens, disputed, status, error, created_at
           FROM grading_tasks ORDER BY id DESC""",
    )
    if not tasks:
        print("\n  库里还没有任何批改任务。")
        print("  → 说明真实批改一次都还没跑过（或那次走了浏览器直连、没经过后端）。")
        conn.close()
        return 1

    t = tasks[0]
    (tid, mode, tids, qtype, title, chars, deep, score, mx, rate,
     ms, calls, pt, ct, disputed, status, error, created) = t

    teachers = [x for x in (tids or "").split(",") if x]
    print("\n── 最近一次批改 " + "─" * 44)
    print(f"  {pad('任务 ID', 12)}{tid}")
    print(f"  {pad('时间', 12)}{created}")
    print(f"  {pad('模式', 12)}{mode}（{len(teachers)} 位：{', '.join(teachers) or '—'}）"
          + ("  · 深度模式" if deep else "  · 常规模式"))
    print(f"  {pad('题目', 12)}{qtype} · {title[:40] or '—'}")
    print(f"  {pad('作答', 12)}{chars} 字")
    if status != "success":
        print(f"  {pad('状态', 12)}**{status}** {error}")
    print(f"  {pad('得分', 12)}{score:g} / {mx:g}（{rate * 100:.1f}%）")
    print(f"  {pad('LLM 调用', 12)}{calls} 次 · 耗时 {ms / 1000:.1f} 秒 · "
          f"圆桌分歧 {'有' if disputed else '无'}")

    total_tokens = pt + ct
    cost = money(pt, ct)
    print("\n── Token 与成本（按 DeepSeek 价目折算）" + "─" * 28)
    print(f"  {pad('Prompt', 14)}{pt:>8,} tokens")
    print(f"  {pad('Completion', 14)}{ct:>8,} tokens")
    print(f"  {pad('合计', 14)}{total_tokens:>8,} tokens")
    print(f"  {pad('估算成本', 14)}¥{cost:.4f}")

    print("\n── 逐次调用明细 " + "─" * 44)
    detail = rows(
        cur,
        """SELECT teacher_id, stage, model, prompt_tokens, completion_tokens,
                  elapsed_ms, ok, error
           FROM llm_call_logs WHERE task_id = ? ORDER BY id""",
        (tid,),
    )
    if detail:
        head = f"  {pad('阶段', 10)}{pad('老师', 10)}{pad('模型', 18)}{'prompt':>8}{'compl':>8}{'耗时':>9}"
        print(head)
        for teacher, stage, model, p2, c2, ms2, ok, err in detail:
            flag = "" if ok else "  **失败** " + (err or "")[:40]
            print(f"  {pad(stage, 10)}{pad(teacher or '—', 10)}{pad((model or '—')[:17], 18)}"
                  f"{p2:>8,}{c2:>8,}{ms2 / 1000:>8.1f}s{flag}")
        print(f"  {pad('', 18)}{'合计':>8} {sum(r[3] for r in detail):>8,}"
              f"{sum(r[4] for r in detail):>8,}")
    else:
        print("  （没有逐次明细 —— 这次调用没经过后端记账）")

    print("\n── 验收判据 " + "─" * 48)
    budget = TOKEN_BUDGET
    verdict = "✓ 达标" if total_tokens <= budget else "✗ 超出"
    print(f"  {verdict}  单题总 token {total_tokens:,}（方案验收线 ≤ {budget:,}）")
    target = COST_TARGET.get(mode, 0.22)
    v2 = "✓ 达标" if cost <= target else "✗ 超出"
    print(f"  {v2}  单题成本 ¥{cost:.4f}（{mode} 预估 ¥{target:.2f}）")
    if calls and total_tokens:
        print(f"  · 单次调用均值 {total_tokens // calls:,} tokens，"
              f"其中 completion 占 {ct / total_tokens * 100:.0f}%")
    if model_of(detail) and "deepseek" not in model_of(detail).lower():
        print(f"  ⚠️ 实际模型是「{model_of(detail)}」，上面成本是按 DeepSeek 价目折算的，"
              "真实账单以该厂商价目为准")

    print("\n── 历史累计 " + "─" * 48)
    all_calls = sum(x[11] for x in tasks)
    all_pt = sum(x[12] for x in tasks)
    all_ct = sum(x[13] for x in tasks)
    print(f"  任务 {len(tasks)} 次 · 调用 {all_calls} 次 · "
          f"tokens {all_pt + all_ct:,} · 折算成本 ¥{money(all_pt, all_ct):.4f}")
    okn = sum(1 for x in tasks if x[15] == "success")
    print(f"  成功 {okn} / 失败 {len(tasks) - okn}")
    conn.close()
    return 0


def model_of(detail: list[tuple]) -> str:
    for r in detail:
        if r[2]:
            return r[2]
    return ""


def main() -> int:
    if len(sys.argv) > 1:
        db = Path(sys.argv[1])
        if not db.exists():
            print(f"找不到数据库：{db}")
            return 1
        return report(db)

    found = candidates()
    if not found:
        print("没有找到任何 bluepencil.db。")
        print("可能原因：① 后端从未启动过；② 桌面版还没跑过批改。")
        return 1
    if len(found) > 1:
        print("发现多个数据库，用最近写入的那个（其余用参数指定）：")
        for p in found:
            print(f"  · {p.relative_to(ROOT)}")
    return report(found[0])


if __name__ == "__main__":
    raise SystemExit(main())
