// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
//! 练习记录归档：把一次批改落成 markdown + json。
//!
//! 每条记录写两个同 basename 的文件到 `docs/practice/`：
//!
//! - `2026-09-21-概括数字乡村做法-mu68na1iptf4fr.md`    人可读，VSCode/Typora 直接打开
//! - `2026-09-21-概括数字乡村做法-mu68na1iptf4fr.json`  结构化，供前端「复盘」页读取
//!
//! 前端只读 json；md 是给人翻的。删一条即删两个文件。
//!
//! ⚠️ **渲染格式必须与 Python 版（`record_service.py`）逐字一致**：
//! 这些 md 是用户会长期留存、对比、甚至打印的产物，两个版本（网站版 / 桌面版）
//! 写出来的东西不该长得不一样。所以下面每个空行、每个 `　`（全角空格）都是照抄的。

use std::fs;
use std::path::PathBuf;

use serde_json::{Map, Value};

use crate::db;
use crate::paths;

// 章节编号用的中文数字（一、二、三……）
const CN_NUM: [&str; 11] = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

fn mode_label(m: &str) -> String {
    match m {
        "solo" => "单老师独立批改",
        "duo" => "双老师联合批改",
        "trio" => "三师圆桌合议",
        "roundtable" => "五师圆桌（全席）",
        other => other,
    }
    .to_string()
}

fn status_mark(s: &str) -> &'static str {
    match s {
        "hit" => "✓",
        "partial" => "~",
        "miss" => "✗",
        _ => "·",
    }
}

// 可信度等级与信号符号。取值集合必须与前端 `utils/grading/credibility.js`
// 的 LEVEL / SIGNAL_LEVEL 一致 —— 改一头要改两头，否则这里会退化成破折号。
fn cred_level_label(l: &str) -> &'static str {
    match l {
        "high" => "可信度高",
        "medium" => "基本可信",
        "low" => "仅供参考",
        "unknown" => "无从评估",
        _ => "",
    }
}

fn cred_signal_mark(l: &str) -> &'static str {
    match l {
        "good" => "✓",
        "warn" => "!",
        "bad" => "✗",
        "na" => "—",
        _ => "·",
    }
}

// ─────────────────────────── 取值小工具 ───────────────────────────

fn s_of(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn arr_of<'a>(v: &'a Value, k: &str) -> &'a [Value] {
    v.get(k)
        .and_then(|x| x.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[])
}

fn obj_of<'a>(v: &'a Value, k: &str) -> Option<&'a Map<String, Value>> {
    v.get(k).and_then(|x| x.as_object())
}

/// 数字的显示：整数就显示整数、小数就显示小数。
///
/// ⚠️ 这不是洁癖：Python 的 `f"{40}"` 是 `'40'`、`f"{17.5}"` 是 `'17.5'`；
/// 而 Rust 的 `format!("{}", 40.0f64)` 会给出 `"40"`、`format!("{}", 17.5)` 给出 `"17.5"`，
/// 但 `format!("{}", 17.0)` 也给出 `"17"` —— 与 Python 的 `'17.0'` 对不上。
/// 所以按 JSON 里的原始形态判断，保证两种语言渲染出的 md 一个字都不差。
fn fmt_num(v: Option<&Value>, fallback: &str) -> String {
    match v {
        Some(Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(f) = n.as_f64() {
                if f.fract() == 0.0 {
                    format!("{f:.1}")
                } else {
                    format!("{f}")
                }
            } else {
                fallback.to_string()
            }
        }
        _ => fallback.to_string(),
    }
}

// ─────────────────────────── 路径与文件名 ───────────────────────────

/// 文件名安全化：剔除 Windows 非法字符与全部空白，并限制长度。
fn slug(text: &str, limit: usize) -> String {
    let no_illegal: String = text
        .chars()
        .filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\r' | '\n' | '\t'))
        .collect();
    let trimmed = no_illegal.trim().trim_matches('.');
    let no_ws: String = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
    let out: String = no_ws.chars().take(limit).collect();
    if out.is_empty() {
        "未命名".to_string()
    } else {
        out
    }
}

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b[..4].iter().all(|c| c.is_ascii_digit())
        && b[5..7].iter().all(|c| c.is_ascii_digit())
        && b[8..10].iter().all(|c| c.is_ascii_digit())
}

/// 文件名主干：`<日期>-<标题>-<完整 id>`。
///
/// ⚠️ id 用**完整值**而不是前 8 位：截断后万一两条前缀相同、标题也相同，
/// 就会互相覆盖 —— 而覆盖是静默的（用户只会发现记录少了一条）。
fn stem(record: &Value) -> String {
    let created = s_of(record, "created_at");
    let day = if created.len() >= 10 && is_date(&created[..10]) {
        created[..10].to_string()
    } else {
        // 借 SQLite 的 datetime('now','localtime')，格式与 CURRENT_TIMESTAMP 完全一致，
        // 也就不必为此引一个日期库进来。
        let now = db::now_local();
        if now.len() >= 10 {
            now[..10].to_string()
        } else {
            "0000-00-00".to_string()
        }
    };
    let rid = {
        let s = s_of(record, "id");
        if s.trim().is_empty() {
            "noid".to_string()
        } else {
            s
        }
    };
    format!("{day}-{}-{rid}", slug(&s_of(record, "title"), 28))
}

fn pair(stem: &str) -> (PathBuf, PathBuf) {
    let d = paths::records_dir();
    (d.join(format!("{stem}.json")), d.join(format!("{stem}.md")))
}

fn read_json(p: &std::path::Path) -> Option<Value> {
    let text = fs::read_to_string(p).ok()?;
    serde_json::from_str(&text).ok()
}

/// 遍历所有 json 记录，产出 (json 路径, md 路径, 数据)
fn iter_records() -> Vec<(PathBuf, PathBuf, Value)> {
    let d = paths::records_dir();
    let Ok(entries) = fs::read_dir(&d) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    paths.sort();
    for p in paths {
        if let Some(data) = read_json(&p) {
            out.push((p.clone(), p.with_extension("md"), data));
        }
    }
    out
}

fn find_by_id(rid: &str) -> Vec<(PathBuf, PathBuf)> {
    iter_records()
        .into_iter()
        .filter(|(_, _, d)| d.get("id").map(|x| value_to_string(x)) == Some(rid.to_string()))
        .map(|(j, m, _)| (j, m))
        .collect()
}

/// id 在 JSON 里可能是字符串也可能是数字（前端传的是字符串，但别指望）
fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

// ─────────────────────────── 读写 ───────────────────────────

/// 保存一条记录。同 id 重复保存会覆盖同名文件（可重入）。
pub fn save(record: &Value) -> Result<Value, String> {
    let d = paths::records_dir();
    paths::ensure_dir(&d).map_err(|e| format!("建记录目录失败：{e}"))?;

    let rid = value_to_string(record.get("id").unwrap_or(&Value::Null));
    if rid.is_empty() {
        return Err("记录缺少 id".to_string());
    }

    // 已有同 id 的旧记录（标题改过会换文件名）→ 先清掉，避免留下孤儿文件：
    // 孤儿不会报错，只会在「记录列表」里多出一条永远打不开的条目。
    for (j, m) in find_by_id(&rid) {
        let _ = fs::remove_file(j);
        let _ = fs::remove_file(m);
    }

    let stem = stem(record);
    let (json_path, md_path) = pair(&stem);

    let pretty = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    fs::write(&json_path, pretty).map_err(|e| format!("写 json 失败：{e}"))?;
    fs::write(&md_path, render_markdown(record)).map_err(|e| format!("写 md 失败：{e}"))?;

    Ok(serde_json::json!({
        "id": rid,
        "file": stem,
        "markdown": md_path.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_default(),
        "dir": d.display().to_string(),
    }))
}

fn summarize(data: &Value, has_md: bool) -> Value {
    let preview: String = s_of(data, "summary")
        .replace('\n', " ")
        .trim()
        .chars()
        .take(120)
        .collect();
    let teacher_ids = data
        .get("teacher_ids")
        .cloned()
        .unwrap_or_else(|| Value::Array(vec![]));
    // ⚠️ `json!` 宏里不能直接写 `{ ... }` 块表达式，所以先算好再放进去
    let mode = {
        let m = s_of(data, "mode");
        if m.is_empty() {
            "solo".to_string()
        } else {
            m
        }
    };
    serde_json::json!({
        "id":           s_of(data, "id"),
        "created_at":   s_of(data, "created_at"),
        "title":        s_of(data, "title"),
        "mode":         mode,
        "teacher_ids":  teacher_ids,
        "final_score":  data.get("final_score").cloned().unwrap_or(serde_json::json!(0)),
        "max_score":    data.get("max_score").cloned().unwrap_or(serde_json::json!(40)),
        "level":        s_of(data, "level"),
        "word_count":   data.get("word_count").cloned().unwrap_or(serde_json::json!(0)),
        "preview":      preview,
        "has_markdown": has_md,
    })
}

pub fn list_records(limit: usize, offset: usize) -> Vec<Value> {
    let mut items: Vec<Value> = iter_records()
        .into_iter()
        .map(|(_, m, data)| summarize(&data, m.is_file()))
        .collect();
    // 与 Python 版一致：按 created_at 字符串倒序（这个格式天生可按字典序排时间）
    items.sort_by(|a, b| s_of(b, "created_at").cmp(&s_of(a, "created_at")));
    items.into_iter().skip(offset).take(limit).collect()
}

pub fn get_record(rid: &str) -> Option<Value> {
    iter_records()
        .into_iter()
        .find(|(_, _, d)| value_to_string(d.get("id").unwrap_or(&Value::Null)) == rid)
        .map(|(_, _, d)| d)
}

pub fn delete_record(rid: &str) -> bool {
    let found = find_by_id(rid);
    if found.is_empty() {
        return false;
    }
    for (j, m) in found {
        let _ = fs::remove_file(j);
        let _ = fs::remove_file(m);
    }
    true
}

/// 按 id 取回 markdown 原文（导出用）。文件不在时**现场重渲染**，
/// 这样即使有人手工删了 md 也还能导出。
pub fn markdown_of(rid: &str) -> Option<String> {
    for (_, m, data) in iter_records() {
        if value_to_string(data.get("id").unwrap_or(&Value::Null)) == rid {
            return match fs::read_to_string(&m) {
                Ok(text) => Some(text),
                Err(_) => Some(render_markdown(&data)),
            };
        }
    }
    None
}

// ─────────────────────────── Markdown 渲染 ───────────────────────────

fn teacher_meta(record: &Value, tid: &str) -> Value {
    for t in arr_of(record, "teachers") {
        if value_to_string(t.get("id").unwrap_or(&Value::Null)) == tid {
            return t.clone();
        }
    }
    serde_json::json!({ "id": tid, "name": tid })
}

fn section(lines: &mut Vec<String>, n: &mut usize, name: &str) {
    *n += 1;
    let idx = *n;
    let label = if idx < CN_NUM.len() {
        CN_NUM[idx].to_string()
    } else {
        idx.to_string()
    };
    lines.push(format!("## {label}、{name}"));
    lines.push(String::new());
}

/// 把结构化记录渲染成人可读的 markdown。
pub fn render_markdown(record: &Value) -> String {
    let title = {
        let t = s_of(record, "title");
        if t.is_empty() {
            "未命名练习".to_string()
        } else {
            t
        }
    };
    let mode = mode_label(&s_of(record, "mode"));
    let created = s_of(record, "created_at");
    let max_score = fmt_num(record.get("max_score"), "40");
    let score = fmt_num(record.get("final_score"), "0");
    let level = s_of(record, "level");

    let names = arr_of(record, "teacher_ids")
        .iter()
        .map(|tid| {
            let t = value_to_string(tid);
            let meta = teacher_meta(record, &t);
            let name = s_of(&meta, "name");
            if name.is_empty() {
                t
            } else {
                name
            }
        })
        .collect::<Vec<_>>()
        .join(" · ");

    let mut l: Vec<String> = Vec::new();
    l.push(format!("# {title}"));
    l.push(String::new());

    let mut head = format!("> **{created}** ｜ {mode} ｜ **{score} / {max_score} 分**");
    if !level.is_empty() {
        head.push_str(&format!("（{level}）"));
    }
    l.push(head);
    if !names.is_empty() {
        l.push(format!("> 阅卷老师：{names}"));
    }
    if let Some(ms) = record.get("elapsed_ms").and_then(|x| x.as_f64()) {
        if ms > 0.0 {
            l.push(format!("> 批改耗时：{:.1} 秒", ms / 1000.0));
        }
    }

    // —— 评分可信度 ——
    // 放在最显眼的开头：一个分数如果没有「能信到什么程度」的说明，
    // 半年后翻出来就是一个无从判断的数字。
    if let Some(cred) = obj_of(record, "credibility") {
        let cred_v = Value::Object(cred.clone());
        let label = cred_level_label(&s_of(&cred_v, "level"));
        let cs = fmt_num(cred_v.get("score"), "0");
        let mut line = format!(
            "> **评分可信度：{} · {cs}**",
            if label.is_empty() { "—" } else { label }
        );
        let headline = s_of(&cred_v, "headline");
        if !headline.is_empty() {
            line.push_str(&format!(" —— {headline}"));
        }
        l.push(line);

        for sig in arr_of(&cred_v, "signals") {
            let mark = cred_signal_mark(&s_of(sig, "level"));
            l.push(format!(
                ">   - {mark} **{}**：{}",
                s_of(sig, "label"),
                s_of(sig, "valueText")
            ));
            let basis = s_of(sig, "basis");
            if !basis.is_empty() {
                l.push(format!(">     - 口径：{basis}"));
            }
        }
        for c in arr_of(&cred_v, "caveats") {
            l.push(format!(">   - ⚠ {}", value_to_string(c)));
        }
    }

    l.push(String::new());

    // 章节号按实际出现的章节递增 —— 「给定资料」为空时不该留下一、三的跳号
    let mut sec_n = 0usize;

    // —— 题目 ——
    section(&mut l, &mut sec_n, "题目");
    let requirement = s_of(record, "requirement");
    if !requirement.is_empty() {
        l.push(requirement);
        l.push(String::new());
    }
    let mut meta_bits = vec![format!("满分 {max_score} 分")];
    let word_limit = fmt_num(record.get("word_limit"), "");
    if !word_limit.is_empty() {
        meta_bits.push(format!("字数要求 {word_limit} 字"));
    }
    let word_count = fmt_num(record.get("word_count"), "");
    if !word_count.is_empty() {
        meta_bits.push(format!("实际作答 {word_count} 字"));
    }
    l.push(meta_bits.join("　"));
    l.push(String::new());

    let material = s_of(record, "material");
    if !material.is_empty() {
        section(&mut l, &mut sec_n, "给定资料");
        l.push(material);
        l.push(String::new());
    }

    section(&mut l, &mut sec_n, "我的作答");
    let answer = s_of(record, "answer");
    l.push(if answer.is_empty() {
        "（无）".to_string()
    } else {
        answer
    });
    l.push(String::new());

    // —— 各老师批注 ——
    let teacher_results = arr_of(record, "teacher_results");
    if !teacher_results.is_empty() {
        section(&mut l, &mut sec_n, "老师批注");
        for tr in teacher_results {
            let tid = {
                let a = s_of(tr, "teacherId");
                if a.is_empty() {
                    s_of(tr, "teacher_id")
                } else {
                    a
                }
            };
            let t = teacher_meta(record, &tid);
            let tname = {
                let n = s_of(&t, "name");
                if n.is_empty() {
                    tid.clone()
                } else {
                    n
                }
            };
            let ttitle = s_of(&t, "title");
            let tr_score = fmt_num(tr.get("score"), "—");
            let tr_max = fmt_num(tr.get("maxScore"), "—");
            l.push(format!("### {tname} · {ttitle}　`{tr_score} / {tr_max}`"));
            l.push(String::new());

            let anns = arr_of(tr, "annotations");
            if !anns.is_empty() {
                l.push("**逐句批注**".to_string());
                l.push(String::new());
                for a in anns {
                    let quote = s_of(a, "quote").trim().to_string();
                    let kind = s_of(a, "type").trim().to_string();
                    let comment = s_of(a, "comment").trim().to_string();
                    let fix = s_of(a, "fix").trim().to_string();
                    let mut seg = format!("- 「{quote}」");
                    if !kind.is_empty() {
                        seg.push_str(&format!(" *{kind}*"));
                    }
                    if !comment.is_empty() {
                        seg.push_str(&format!(" —— {comment}"));
                    }
                    l.push(seg);
                    if !fix.is_empty() {
                        l.push(format!("  - 改：{fix}"));
                    }
                }
                l.push(String::new());
            }

            let advice = s_of(tr, "advice").trim().to_string();
            if !advice.is_empty() {
                l.push("**修改建议**".to_string());
                l.push(String::new());
                l.push(advice);
                l.push(String::new());
            }

            let dims = arr_of(tr, "dimensions");
            if !dims.is_empty() {
                l.push("**分项得分**".to_string());
                l.push(String::new());
                for d in dims {
                    let mut line = format!(
                        "- {}　{} / {}",
                        s_of(d, "name"),
                        fmt_num(d.get("score"), "—"),
                        fmt_num(d.get("max"), "—")
                    );
                    let cm = s_of(d, "comment");
                    if !cm.is_empty() {
                        line.push_str(&format!(" —— {cm}"));
                    }
                    l.push(line);
                }
                l.push(String::new());
            }

            let deductions = arr_of(tr, "deductions");
            if !deductions.is_empty() {
                l.push("**扣分点**".to_string());
                l.push(String::new());
                for d in deductions {
                    let mut line = format!("- {}", s_of(d, "point"));
                    let reason = s_of(d, "reason");
                    if !reason.is_empty() {
                        line.push_str(&format!(" —— {reason}"));
                    }
                    l.push(line);
                    let fix = s_of(d, "fix");
                    if !fix.is_empty() {
                        l.push(format!("  - 改：{fix}"));
                    }
                }
                l.push(String::new());
            }

            let summary = s_of(tr, "summary").trim().to_string();
            if !summary.is_empty() {
                l.push("**总评**".to_string());
                l.push(String::new());
                l.push(summary);
                l.push(String::new());
            }
        }
    }

    // —— 圆桌合议 ——
    if let Some(debate) = obj_of(record, "debate") {
        let dv = Value::Object(debate.clone());
        let disputes = arr_of(&dv, "disputes");
        if !disputes.is_empty() {
            section(&mut l, &mut sec_n, "圆桌分歧裁定");
            for d in disputes {
                l.push(format!("- **{}**", s_of(d, "topic")));
                for p in arr_of(d, "positions") {
                    let pid = s_of(p, "teacher");
                    let meta = teacher_meta(record, &pid);
                    let pname = {
                        let n = s_of(&meta, "name");
                        if n.is_empty() {
                            pid
                        } else {
                            n
                        }
                    };
                    l.push(format!("  - {pname}：{}", s_of(p, "view")));
                }
                l.push(format!("  - 裁定：{}", s_of(d, "ruling")));
                let reason = s_of(d, "reason");
                if !reason.is_empty() {
                    l.push(format!("  - 依据：{reason}"));
                }
            }
            l.push(String::new());
            let overall = s_of(&dv, "overall").trim().to_string();
            if !overall.is_empty() {
                l.push(overall);
                l.push(String::new());
            }
        }
    }

    // —— 综合结论 ——
    section(&mut l, &mut sec_n, "综合结论");
    let note = s_of(record, "roundtable_note");
    if !note.is_empty() {
        l.push(format!("> {note}"));
        l.push(String::new());
    }
    let summary = s_of(record, "summary").trim().to_string();
    if !summary.is_empty() {
        l.push(summary);
        l.push(String::new());
    }

    let kps = arr_of(record, "key_points");
    if !kps.is_empty() {
        let hit = kps
            .iter()
            .filter(|k| s_of(k, "status") == "hit")
            .count();
        l.push(format!("**采分点核对**（命中 {hit} / {}）", kps.len()));
        l.push(String::new());
        for k in kps {
            let mut line = format!("- {} {}", status_mark(&s_of(k, "status")), s_of(k, "point"));
            let note = s_of(k, "note");
            if !note.is_empty() {
                line.push_str(&format!(" —— {note}"));
            }
            l.push(line);
        }
        l.push(String::new());
    }

    let crit = arr_of(record, "critical_issues");
    if !crit.is_empty() {
        l.push("**优先解决**".to_string());
        l.push(String::new());
        for d in crit {
            let mut line = format!("- {}", s_of(d, "issue"));
            let src = s_of(d, "source");
            if !src.is_empty() {
                line.push_str(&format!("（{src}）"));
            }
            l.push(line);
            let fix = s_of(d, "fix");
            if !fix.is_empty() {
                l.push(format!("  - 改：{fix}"));
            }
        }
        l.push(String::new());
    }

    let minor = arr_of(record, "minor_issues");
    if !minor.is_empty() {
        l.push("**次要问题**".to_string());
        l.push(String::new());
        for d in minor {
            let mut line = format!("- {}", s_of(d, "issue"));
            let fix = s_of(d, "fix");
            if !fix.is_empty() {
                line.push_str(&format!(" —— {fix}"));
            }
            l.push(line);
        }
        l.push(String::new());
    }

    let hl = arr_of(record, "highlights");
    if !hl.is_empty() {
        l.push("**亮点**".to_string());
        l.push(String::new());
        for h in hl {
            let mut line = format!("- {}", s_of(h, "point"));
            let why = s_of(h, "why");
            if !why.is_empty() {
                line.push_str(&format!(" —— {why}"));
            }
            // Python 那边是 `f"- {point} —— {why}".rstrip(" ——")`：why 为空时
            // 要把尾巴上的分隔符去掉，否则会留下一个孤零零的破折号
            let cleaned = line.trim_end_matches(" ——").trim_end().to_string();
            l.push(cleaned);
        }
        l.push(String::new());
    }

    let sugg = arr_of(record, "suggestions");
    if !sugg.is_empty() {
        l.push("**改进建议（按优先级）**".to_string());
        l.push(String::new());
        for (i, s) in sugg.iter().enumerate() {
            l.push(format!("{}. {}", i + 1, value_to_string(s)));
        }
        l.push(String::new());
    }

    l.push("---".to_string());
    l.push(String::new());
    l.push("*由 蓝笔申论 BluePencil 生成，AI 批改仅供学习参考。*".to_string());
    l.push(String::new());

    l.join("\n")
}
