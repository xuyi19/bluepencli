# ──────────────────────────────────────────────────────────────
# 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
# GitHub: https://github.com/xuyi19/bluepencli
# Gitee : https://gitee.com/xuyi_19/bluepencil
# 许可: AGPL-3.0 · 转发或修改请保留本署名
# ──────────────────────────────────────────────────────────────
"""真实批改的成本与 Token 实测报告。

为什么要它：项目从 v0.1.0 起所有验证都在代码层与接口层跑，「一次真实批改要花
多少钱、耗多少 token」这件事一直没实测过 —— 牌面上只有预估（三师 ¥0.12 / 五师
¥0.22）。跑完第一次真 Key 之后用这个脚本把数字拿出来。

用法：
    backend/.venv/Scripts/python.exe .tools/report-cost.py            # 自动挑**有真实记账**的库
    backend/.venv/Scripts/python.exe .tools/report-cost.py <db 路径>  # 指定

数据来源：后端 SQLite（`llm_call_logs` 逐次明细为准）。
⚠️ 前端填自己的 Key 时，请求仍经后端转发（chatBackend），所以一样会被记账；
只有后端没起来、走浏览器直连的那次不会被记 —— 报告里会出现「0 次调用」，
那不是没花钱，是没记账。

配套：`node .tools/prompt-size.mjs` 回答「单次调用为什么这么大、能否优化」。
本报告回答「实际花了多少」，那边回答「钱花在哪」——两个要对着看。
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ── 价目表（元 / 百万 token，输入、输出）──────────────────────────
#
# ⚠️ 曾经只有一个写死的 DeepSeek 价目，而第一次真实批改用**智谱 glm-4-flash**跑出来，
#    报告却按 DeepSeek 折算 —— 数字差了两个数量级，等于没测。
#    教训：**价目必须跟着实际模型走**，不能默认用户用哪家。
#
# 查价日 2026-09-18，价目会变，改前先看厂商官网。
MODEL_PRICES: dict[str, tuple[float, float]] = {
    # 智谱（开放平台 bigmodel.cn）
    "glm-4-flash": (0.5, 1.0),
    "glm-4-flash-250414": (0.5, 1.0),
    "glm-4-air": (1.0, 1.0),
    "glm-4": (10.0, 10.0),
    "glm-4-plus": (50.0, 50.0),
    # DeepSeek（platform.deepseek.com）
    "deepseek-chat": (2.0, 8.0),
    "deepseek-reasoner": (2.0, 8.0),
    # 兜底：没收录的模型按 DeepSeek 口径估
    "_default": (2.0, 8.0),
}
PRICE_TABLE_NOTE = "查价日 2026-09-18"

# 验收线
#
# ⚠️ 这里原先只有「单题 ≤ TOKEN_BUDGET」一条，而那 2500 是**按一次 LLM 调用**
# 估出来的；三师圆桌一次批改天然是 3 次 grade + 1 次合议 = 4 次调用，于是报告
# 必然打出「✗ 超出 6.2 倍」—— 看着像设计严重超标，其实是**拿整题去比单次预算**，
# 尺子用错了层。
#
# 现在拆成两条线，各回答各的问题：
#   ① 单次调用 ≤ TOKEN_BUDGET_PER_CALL —— 这条才是在控「prompt 别太大」（方案本意）
#   ② 整题 ≤ TOKEN_BUDGET_PER_CALL × 有效调用数 —— 多位老师是线性叠加，
#      这条查的是"有没有比线性更糟"（比如有人被重试了一次、或某段 prompt 失控）
#
# 分层之后能诚实回答：单次调用实测约 4,200 tokens，**确实超出 2500 约 1.7 倍**；
# 但归因清楚（见 .tools/prompt-size.mjs）：输出契约 + 采分点标准注入占大头，
# 两者都是为了保证"批改可复算、type 走受控词表"而必需的，**不是被浪费撑爆的**。
# 换句话说：当初那 2500 是估低了，不是后来写坏了。
TOKEN_BUDGET_PER_CALL = 2500
COST_TARGET = {"solo": 0.03, "duo": 0.08, "roundtable": 0.22}


def price_of(model: str) -> tuple[float, float]:
    """按模型名找价目；带日期后缀的（如 glm-4-flash-250414）也能命中主名。"""
    name = (model or "").strip().lower()
    if not name:
        return MODEL_PRICES["_default"]
    if name in MODEL_PRICES:
        return MODEL_PRICES[name]
    # 前缀匹配：glm-4-flash-250414 → glm-4-flash（取最长的匹配，避免 glm-4 抢走 glm-4-plus）
    hits = [k for k in MODEL_PRICES if k != "_default" and name.startswith(k)]
    if hits:
        return MODEL_PRICES[max(hits, key=len)]
    return MODEL_PRICES["_default"]


def is_priced(model: str) -> bool:
    """该模型是否在价目表里（不在就是要用兜底价，得提醒）"""
    return bool(model) and price_of(model) != MODEL_PRICES["_default"] or (
        (model or "").strip().lower() in MODEL_PRICES
    )


def disp_len(s: str) -> int:
    """按显示宽度计长度（中日韩字符占 2 格）"""
    return sum(2 if ord(c) > 0x2E80 else 1 for c in s)


def pad(s: str, width: int) -> str:
    return s + " " * max(0, width - disp_len(s))


def _has_real_usage(db: Path) -> bool:
    """这个库里有没有**真的记账过的调用**（token > 0）。

    为什么要单独判：本机通常同时存在好几个库 —— 刚打包出来还没跑过的空库、
    只用假 LLM 跑过链路的库（模型名是 `mock-model`、token 恒为 0）、
    以及那个真正拿着 Key 批过一次的库。按写入时间挑会挑到前两种，
    于是报告打出「合计 0 tokens · ✓ 达标」——看着像通过了，其实什么都没测到。
    **这正是「假绿」**：比报错危险得多。
    """
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            cur = conn.execute(
                "SELECT COUNT(*) FROM llm_call_logs "
                "WHERE COALESCE(prompt_tokens,0) + COALESCE(completion_tokens,0) > 0"
            )
            return (cur.fetchone() or (0,))[0] > 0
        finally:
            conn.close()
    except sqlite3.Error:
        return False


def candidates() -> list[Path]:
    """候选数据库，**有真实记账的排前面**，其次按最后写入时间倒序。

    ⚠️ 两处坑都踩过：
      ① 以前只扫 `release/` 的**一级子目录**，而产物归档后真库跑进了
         `release/桌面版/历史版本/<版本>/data/` —— 于是报告看不见那次真实批改，
         只剩刚打包出来的空库。**布局一变、扫描就跟不上**（本项目第 N 次栽在这上面）。
         现在递归 `rglob` —— 目录层级不该决定"能不能找到数据"。
      ② 排序原先只按 mtime，于是空库/假数据库排在前面。见 `_has_real_usage`。
    """
    found: list[Path] = []
    backend_db = ROOT / "backend" / "data" / "bluepencil.db"
    if backend_db.exists():
        found.append(backend_db)
    release = ROOT / "release"
    if release.is_dir():
        found.extend(release.rglob("data/bluepencil.db"))
    # 去重（同一文件可能跟 release 根/历史版本 都命中）+ 真实性优先
    seen: set[str] = set()
    uniq: list[Path] = []
    for p in found:
        key = str(p.resolve()).lower()
        if key in seen:
            continue
        seen.add(key)
        uniq.append(p)
    return sorted(uniq, key=lambda p: (not _has_real_usage(p), -p.stat().st_mtime))


def money(prompt_tokens: int, completion_tokens: int, model: str = "") -> float:
    """按**该次调用实际用的模型**折价。model 为空时用兜底价。"""
    pi, po = price_of(model)
    return (prompt_tokens / 1_000_000) * pi + (completion_tokens / 1_000_000) * po


def money_by_model(detail: list[tuple]) -> tuple[float, str]:
    """逐次调用按各自模型折价再求和（一次批改里可能混用模型）。

    detail 行结构：teacher, stage, model, prompt, completion, ms, ok, err
    """
    total = 0.0
    models: list[str] = []
    for r in detail:
        m = r[2] or ""
        if m and m not in models:
            models.append(m)
        total += money(r[3] or 0, r[4] or 0, m)
    return total, "、".join(models)


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

    # ⚠️ 任务表的 prompt_tokens / completion_tokens **永远是 0**：
    #    前端上报任务时不带这个字段（它手里没有），后端逐次记账在 llm_call_logs，
    #    但没有任何环节把逐次结果汇总回填到任务行。
    #    所以这里一律以 llm_call_logs 为准 —— 否则报告会显示「0 token / ¥0」，看着达标其实没测。
    #    （若将来做了回填，下面的 fallback 会自动生效，不用改报告。）
    detail_raw = rows(
        cur,
        """SELECT teacher_id, stage, model, prompt_tokens, completion_tokens,
                  elapsed_ms, ok, error
           FROM llm_call_logs WHERE task_id = ? ORDER BY id""",
        (tid,),
    )
    # detail 行不含 task_id，供 money_by_model 使用
    detail = [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]) for r in detail_raw]

    calls_pt = sum(r[3] or 0 for r in detail)
    calls_ct = sum(r[4] or 0 for r in detail)
    if calls_pt or calls_ct:
        pt, ct = calls_pt, calls_ct
        token_source = "逐次调用明细求和"
    else:
        token_source = "任务行字段（无明细可用）"

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
    cost, models_used = money_by_model(detail)
    if not detail:
        cost = money(pt, ct)
    print("\n── Token 与成本 " + "─" * 48)
    print(f"  {pad('Prompt', 14)}{pt:>8,} tokens")
    print(f"  {pad('Completion', 14)}{ct:>8,} tokens")
    print(f"  {pad('合计', 14)}{total_tokens:>8,} tokens  （{token_source}）")
    print(f"  {pad('估算成本', 14)}¥{cost:.4f}"
          + (f"  （按 {models_used} 价目，{PRICE_TABLE_NOTE}）" if models_used else ""))

    print("\n── 逐次调用明细 " + "─" * 44)
    if detail:
        head = f"  {pad('阶段', 10)}{pad('老师', 10)}{pad('模型', 18)}{'prompt':>8}{'compl':>8}{'耗时':>9}"
        print(head)
        for teacher, stage, model, p2, c2, ms2, ok, err in detail:
            flag = "" if ok else "  **失败** " + (err or "")[:40]
            print(f"  {pad(stage, 10)}{pad(teacher or '—', 10)}{pad((model or '—')[:17], 18)}"
                  f"{p2:>8,}{c2:>8,}{ms2 / 1000:>8.1f}s{flag}")
        print(f"  {pad('', 18)}{'合计':>8} {sum(r[3] for r in detail):>8,}"
              f"{sum(r[4] for r in detail):>8,}")
        # 逐次折价，便于对比哪一段最贵
        seg: dict[str, float] = {}
        for r in detail:
            seg[r[1] or "—"] = seg.get(r[1] or "—", 0.0) + money(r[3] or 0, r[4] or 0, r[2] or "")
        if len(seg) > 1:
            print(f"  {'分段成本：' + '，'.join(f'{k} ¥{v:.4f}' for k, v in seg.items())}")
    else:
        print("  （没有逐次明细 —— 这次调用没经过后端记账）")

    print("\n── 验收判据 " + "─" * 48)
    # 分「单次调用」与「整题」两层：原先把整题总量直接跟单次预算比，
    # 于是多老师模式永远超额 —— 那是量纲错配，不是真的设计超标。
    per_call = [(r[3] or 0) + (r[4] or 0) for r in detail] or ([total_tokens] if total_tokens else [])
    peak = max(per_call) if per_call else 0
    mean = sum(per_call) // len(per_call) if per_call else 0
    n_call = len(per_call) or 1

    if per_call:
        v1 = "✓ 达标" if peak <= TOKEN_BUDGET_PER_CALL else "✗ 超出"
        print(f"  {v1}  单次调用峰值 {peak:,} tokens"
              f"（方案验收线 ≤ {TOKEN_BUDGET_PER_CALL:,}/次"
              + (f"，超 {peak / TOKEN_BUDGET_PER_CALL:.1f} 倍）" if peak > TOKEN_BUDGET_PER_CALL else "）"))
        print(f"     均值 {mean:,} · 共 {n_call} 次调用")
        linear = TOKEN_BUDGET_PER_CALL * n_call
        v3 = "✓ 达标" if total_tokens <= linear else "✗ 超出"
        print(f"  {v3}  单题总量 {total_tokens:,} tokens"
              f"（{n_call} 次调用的线性预算 ≤ {linear:,}"
              + (f"，超 {total_tokens / linear:.1f} 倍）" if total_tokens > linear else "）"))
    if per_call and peak > TOKEN_BUDGET_PER_CALL:
        print("     ↳ 单次超限的归因见 `node .tools/prompt-size.mjs`：")
        print("       输出契约 + 采分点标准注入占 system 的绝大部分，都是质量必需项，")
        print("       → **当初 2500 这条线估低了**，不是后来写坏了。")

    target = COST_TARGET.get(mode, 0.22)
    v2 = "✓ 达标" if cost <= target else "✗ 超出"
    print(f"  {v2}  单题成本 ¥{cost:.4f}（{mode} 预估 ¥{target:.2f}）")
    if calls and total_tokens:
        print(f"  · 单次调用均值 {total_tokens // calls:,} tokens，"
              f"其中 completion 占 {ct / total_tokens * 100:.0f}%")
    unknown = [m for m in (models_used or "").split("、") if m and not is_priced(m)]
    if unknown:
        print(f"  ⚠️ 模型「{'、'.join(unknown)}」不在价目表里，已按兜底价估算 —— "
              "真实账单以该厂商价目为准，请补进 MODEL_PRICES")

    print("\n── 历史累计 " + "─" * 48)
    all_calls = sum(x[11] for x in tasks)
    # 同样以明细为准：任务行 token 字段是空的，拿它累加会恒等于 0
    hist = rows(
        cur,
        """SELECT model, prompt_tokens, completion_tokens FROM llm_call_logs""",
    )
    if hist:
        all_pt = sum(r[1] or 0 for r in hist)
        all_ct = sum(r[2] or 0 for r in hist)
        all_cost = sum(money(r[1] or 0, r[2] or 0, r[0] or "") for r in hist)
    else:
        all_pt = sum(x[12] for x in tasks)
        all_ct = sum(x[13] for x in tasks)
        all_cost = money(all_pt, all_ct)
    print(f"  任务 {len(tasks)} 次 · 调用 {len(hist) or all_calls} 次 · "
          f"tokens {all_pt + all_ct:,} · 折算成本 ¥{all_cost:.4f}")
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
        real = [p for p in found if _has_real_usage(p)]
        print(f"发现 {len(found)} 个数据库，"
              f"优先用**真的记账过调用**的那个"
              f"（共 {len(real)} 个有真实数据；其余用参数指定）：")
        for p in found:
            mark = "★ 有真实记账" if p in real else "· 无数据/仅假 LLM"
            print(f"  {mark}  {p.relative_to(ROOT)}")
        if not real:
            print()
            print("  ⚠️ 这些库里都没有真实调用的 token 记录 ——")
            print("     下面的数字会是 0，且「✓ 达标」是**没有意义的**。")
            print("     要拿到真数字，得用真实 Key 跑一次批改（请求需经过后端才会被记账）。")
    return report(found[0])


if __name__ == "__main__":
    raise SystemExit(main())
