"""练习记录归档：把一次批改落盘成 markdown。

每条记录写两个同 basename 的文件到 `docs/practice/`：

- `2026-09-11-养老刚需-abc12345.md`    人类可读的完整记录，VSCode/Typora 直接打开
- `2026-09-11-养老刚需-abc12345.json`  结构化数据，供前端「复盘」页读取

前端只读 json；md 是给（你）自己翻的。删一条即删两个文件。

为什么存两份而不是只存一份：
  · 只存 md  → 前端要解析 markdown 才能做色标复盘，脆弱且要引依赖
  · 只存 json → 打开文件读起来费劲，不符合「存入 docs 便于复盘」的诉求
"""

import json
import re
from datetime import datetime
from pathlib import Path

from app.core import config

# Windows 文件名非法字符 + 换行/制表
_ILLEGAL = re.compile(r'[\\/:*?"<>|\r\n\t]+')
_WS = re.compile(r"\s+")

MODE_LABEL = {
    "solo": "单老师独立批改",
    "duo": "双老师联合批改",
    "trio": "三师圆桌合议",
    "roundtable": "五师圆桌（全席）",
}

STATUS_MARK = {"hit": "✓", "partial": "~", "miss": "✗"}

# 可信度等级与信号的显示符号（与前端 utils/grading/credibility.js 的 LEVEL / SIGNAL_LEVEL 对应；
# 两边的**取值集合**必须一致，改一头要改两头）
CRED_LEVEL_LABEL = {
    "high": "可信度高",
    "medium": "基本可信",
    "low": "仅供参考",
    "unknown": "无从评估",
}
CRED_SIGNAL_MARK = {"good": "✓", "warn": "!", "bad": "✗", "na": "—"}

# 章节编号用的中文数字（一、二、三……）
_CN_NUM = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]


# ---------------- 路径与文件名 ----------------

def records_dir() -> Path:
    """延迟读取，方便测试里 monkeypatch config.RECORDS_DIR。"""
    return Path(config.RECORDS_DIR)


def _slug(text: str, limit: int = 28) -> str:
    s = _ILLEGAL.sub("", str(text or "")).strip().strip(".")
    s = _WS.sub("", s)
    return s[:limit] or "未命名"


def _stem(record: dict) -> str:
    day = str(record.get("created_at") or "")[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        day = datetime.now().strftime("%Y-%m-%d")
    # id 用完整值而不是前 8 位：截断后万一两条前缀相同、标题也相同，就会互相覆盖
    rid = str(record.get("id") or "").strip() or "noid"
    return f"{day}-{_slug(record.get('title'))}-{rid}"


def _pair(stem: str) -> tuple[Path, Path]:
    d = records_dir()
    return d / f"{stem}.json", d / f"{stem}.md"


# ---------------- 读写 ----------------

def save(record: dict) -> dict:
    """写盘。同一条 id 重复保存会覆盖同名文件（可重入）。"""
    d = records_dir()
    d.mkdir(parents=True, exist_ok=True)

    # 已有同 id 的旧记录（标题改过会换文件名）→ 先清掉，避免留下孤儿
    for old in _find_by_id(record["id"]):
        for p in old:
            try:
                p.unlink()
            except OSError:
                pass

    stem = _stem(record)
    json_path, md_path = _pair(stem)
    json_path.write_text(
        json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    md_path.write_text(render_markdown(record), encoding="utf-8")
    return {
        "id": record["id"],
        "file": stem,
        "markdown": md_path.name,
        "dir": str(d),
    }


def list_records(limit: int = 100, offset: int = 0) -> list[dict]:
    d = records_dir()
    if not d.is_dir():
        return []

    items = []
    for path in d.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        items.append(_to_summary(data, has_md=path.with_suffix(".md").is_file()))

    items.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
    return items[offset : offset + limit]


def get_record(rid: str) -> dict | None:
    for _json_path, _md_path, data in _iter_records():
        if str(data.get("id")) == str(rid):
            return data
    return None


def delete_record(rid: str) -> bool:
    found = _find_by_id(rid)
    if not found:
        return False
    ok = False
    for j, m in found:
        for p in (j, m):
            try:
                p.unlink()
                ok = True
            except FileNotFoundError:
                ok = True
            except OSError:
                pass
    return ok


def markdown_of(rid: str) -> str | None:
    """按 id 取回 markdown 原文（导出用）。"""
    for j, m, data in _iter_records():
        if str(data.get("id")) == str(rid):
            if m.is_file():
                return m.read_text(encoding="utf-8")
            return render_markdown(data)
    return None


# ---------------- 内部工具 ----------------

def _iter_records():
    d = records_dir()
    if not d.is_dir():
        return
    for path in sorted(d.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        yield path, path.with_suffix(".md"), data


def _find_by_id(rid: str) -> list[tuple[Path, Path]]:
    return [(j, m) for j, m, data in _iter_records() if str(data.get("id")) == str(rid)]


def _to_summary(data: dict, has_md: bool = True) -> dict:
    preview = str(data.get("summary") or "").replace("\n", " ").strip()
    return {
        "id": data.get("id", ""),
        "created_at": data.get("created_at", ""),
        "title": data.get("title", ""),
        "mode": data.get("mode", "solo"),
        "teacher_ids": data.get("teacher_ids", []),
        "final_score": data.get("final_score", 0),
        "max_score": data.get("max_score", 40),
        "level": data.get("level", ""),
        "word_count": data.get("word_count", 0),
        "preview": preview[:120],
        "has_markdown": has_md,
    }


# ---------------- Markdown 渲染 ----------------

def _teacher_meta(record: dict, tid: str) -> dict:
    for t in record.get("teachers") or []:
        if str(t.get("id")) == str(tid):
            return t
    return {"id": tid, "name": tid}


def _lines(seq, fmt) -> list[str]:
    """把一批条目渲染成 markdown 列表；空值跳过。"""
    out = []
    for item in seq or []:
        text = fmt(item)
        if text:
            out.append(text)
    return out


def render_markdown(record: dict) -> str:
    """把结构化记录渲染成人可读的 markdown。"""
    title = record.get("title") or "未命名练习"
    mode = MODE_LABEL.get(record.get("mode") or "", record.get("mode") or "")
    created = record.get("created_at") or ""
    score = record.get("final_score") or 0
    max_score = record.get("max_score") or 40
    level = record.get("level") or ""
    names = " · ".join(
        _teacher_meta(record, tid).get("name", tid)
        for tid in (record.get("teacher_ids") or [])
    )

    L: list[str] = []
    L.append(f"# {title}")
    L.append("")
    head = f"> **{created}** ｜ {mode} ｜ **{score} / {max_score} 分**"
    if level:
        head += f"（{level}）"
    L.append(head)
    if names:
        L.append(f"> 阅卷老师：{names}")
    if record.get("elapsed_ms"):
        L.append(f"> 批改耗时：{record['elapsed_ms'] / 1000:.1f} 秒")

    # —— 评分可信度 ——
    # 放在最显眼的开头：一个分数如果没有"能信到什么程度"的说明，
    # 半年后翻出来就是一个无从判断的数字。
    cred = record.get("credibility") or {}
    if cred:
        label = CRED_LEVEL_LABEL.get(str(cred.get("level") or ""), "")
        head = f"> **评分可信度：{label or '—'} · {cred.get('score', 0)}**"
        if cred.get("headline"):
            head += f" —— {cred['headline']}"
        L.append(head)
        for s in cred.get("signals") or []:
            mark = CRED_SIGNAL_MARK.get(str(s.get("level") or ""), "·")
            L.append(f">   - {mark} **{s.get('label', '')}**：{s.get('valueText', '')}")
            if s.get("basis"):
                L.append(f">     - 口径：{s['basis']}")
        for c in cred.get("caveats") or []:
            L.append(f">   - ⚠ {c}")

    L.append("")

    # 章节号按实际出现的章节递增——「给定资料」为空时不该留下一、三的跳号
    counter = {"n": 0}

    def section(name: str) -> None:
        counter["n"] += 1
        idx = counter["n"]
        L.append(f"## {_CN_NUM[idx] if idx < len(_CN_NUM) else idx}、{name}")
        L.append("")

    # —— 题目 ——
    section("题目")
    if record.get("requirement"):
        L.append(record["requirement"])
        L.append("")
    meta_bits = [f"满分 {max_score} 分"]
    if record.get("word_limit"):
        meta_bits.append(f"字数要求 {record['word_limit']} 字")
    if record.get("word_count"):
        meta_bits.append(f"实际作答 {record['word_count']} 字")
    L.append("　".join(meta_bits))
    L.append("")

    if record.get("material"):
        section("给定资料")
        L.append(record["material"])
        L.append("")

    section("我的作答")
    L.append(record.get("answer") or "（无）")
    L.append("")

    # —— 各老师批注 ——
    if record.get("teacher_results"):
        section("老师批注")
        for tr in record["teacher_results"]:
            tid = tr.get("teacherId") or tr.get("teacher_id") or ""
            t = _teacher_meta(record, tid)
            tname = t.get("name") or tid
            ttitle = t.get("title") or ""
            tr_score = tr.get("score", "—")
            tr_max = tr.get("maxScore", "—")
            L.append(f"### {tname} · {ttitle}　`{tr_score} / {tr_max}`")
            L.append("")

            anns = tr.get("annotations") or []
            if anns:
                L.append("**逐句批注**")
                L.append("")
                for a in anns:
                    quote = str(a.get("quote") or "").strip()
                    kind = str(a.get("type") or "").strip()
                    comment = str(a.get("comment") or "").strip()
                    fix = str(a.get("fix") or "").strip()
                    seg = f"- 「{quote}」"
                    if kind:
                        seg += f" *{kind}*"
                    if comment:
                        seg += f" —— {comment}"
                    L.append(seg)
                    if fix:
                        L.append(f"  - 改：{fix}")
                L.append("")

            if tr.get("advice"):
                L.append("**修改建议**")
                L.append("")
                L.append(str(tr["advice"]).strip())
                L.append("")

            dims = tr.get("dimensions") or []
            if dims:
                L.append("**分项得分**")
                L.append("")
                for d in dims:
                    line = f"- {d.get('name', '')}　{d.get('score', '—')} / {d.get('max', '—')}"
                    if d.get("comment"):
                        line += f" —— {d['comment']}"
                    L.append(line)
                L.append("")

            deductions = tr.get("deductions") or []
            if deductions:
                L.append("**扣分点**")
                L.append("")
                for d in deductions:
                    line = f"- {d.get('point', '')}"
                    if d.get("reason"):
                        line += f" —— {d['reason']}"
                    L.append(line)
                    if d.get("fix"):
                        L.append(f"  - 改：{d['fix']}")
                L.append("")

            if tr.get("summary"):
                L.append("**总评**")
                L.append("")
                L.append(str(tr["summary"]).strip())
                L.append("")

    # —— 圆桌合议 ——
    debate = record.get("debate") or {}
    if debate.get("disputes"):
        section("圆桌分歧裁定")
        for d in debate["disputes"]:
            L.append(f"- **{d.get('topic', '')}**")
            for p in d.get("positions") or []:
                pname = _teacher_meta(record, p.get("teacher")).get("name", p.get("teacher"))
                L.append(f"  - {pname}：{p.get('view', '')}")
            L.append(f"  - 裁定：{d.get('ruling', '')}")
            if d.get("reason"):
                L.append(f"  - 依据：{d['reason']}")
        L.append("")
        if debate.get("overall"):
            L.append(str(debate["overall"]).strip())
            L.append("")

    # —— 综合结论 ——
    section("综合结论")
    if record.get("roundtable_note"):
        L.append(f"> {record['roundtable_note']}")
        L.append("")
    if record.get("summary"):
        L.append(str(record["summary"]).strip())
        L.append("")

    kps = record.get("key_points") or []
    if kps:
        hit = sum(1 for k in kps if k.get("status") == "hit")
        L.append(f"**采分点核对**（命中 {hit} / {len(kps)}）")
        L.append("")
        for k in kps:
            mark = STATUS_MARK.get(k.get("status", ""), "·")
            line = f"- {mark} {k.get('point', '')}"
            if k.get("note"):
                line += f" —— {k['note']}"
            L.append(line)
        L.append("")

    crit = record.get("critical_issues") or []
    if crit:
        L.append("**优先解决**")
        L.append("")
        for d in crit:
            line = f"- {d.get('issue', '')}"
            if d.get("source"):
                line += f"（{d['source']}）"
            L.append(line)
            if d.get("fix"):
                L.append(f"  - 改：{d['fix']}")
        L.append("")

    minor = record.get("minor_issues") or []
    if minor:
        L.append("**次要问题**")
        L.append("")
        for d in minor:
            line = f"- {d.get('issue', '')}"
            if d.get("fix"):
                line += f" —— {d['fix']}"
            L.append(line)
        L.append("")

    hl = record.get("highlights") or []
    if hl:
        L.append("**亮点**")
        L.append("")
        L.extend(_lines(hl, lambda h: f"- {h.get('point', '')} —— {h.get('why', '')}".rstrip(" ——")))
        L.append("")

    sugg = record.get("suggestions") or []
    if sugg:
        L.append("**改进建议（按优先级）**")
        L.append("")
        for i, s in enumerate(sugg, 1):
            L.append(f"{i}. {s}")
        L.append("")

    L.append("---")
    L.append("")
    L.append("*由 蓝笔申论 BluePencil 生成，AI 批改仅供学习参考。*")
    L.append("")
    return "\n".join(L)
