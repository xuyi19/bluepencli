// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
//! 记账：批改任务汇总 + 逐次 LLM 调用明细。
//!
//! ── 为什么表结构必须与 Python 侧一字不差 ──
//! `backend/app/models/entities.py` 定义的是**同一份 schema**。桌面版和网站版
//! 共用一套分析工具（`.tools/report-cost.py` 直接读这个库算成本、`prompt-size.mjs`
//! 回答"钱花在哪"）。schema 一旦漂移，那些工具**不会报错**，只会静默读不到数据 ——
//! 正是本项目反复复发的「假绿」。
//!
//! ── 记账分工（与 Python 版相同）──
//! · `grading_tasks`：**前端上报**的任务汇总（分数 / 耗时 / 调用次数）
//! · `llm_call_logs`：**后端逐次转发时记**的明细，含 token ——
//!   成本数字只认这一张表，因为只有它知道每次调用真正花了多少
//!
//! ⚠️ 用户填自己的 Key 也照样记账（请求走后端转发），只有纯浏览器直连不记 ——
//!    所以"0 次调用"往往意味着"没记账"，不是"没花钱"。

use std::sync::{Mutex, MutexGuard, OnceLock};

use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};

use crate::paths;

// DeepSeek 参考价（元 / 百万 token），与 `grading_service.py` 同一条口径。
// 只用于粗略估算：用户可能填别家的 Key，价格不同，所以界面上必须写"估算"。
const PRICE_PROMPT_PER_M: f64 = 2.0;
const PRICE_COMPLETION_PER_M: f64 = 8.0;

static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS grading_tasks (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id           VARCHAR(32)  NOT NULL UNIQUE,
    mode              VARCHAR(16)  NOT NULL DEFAULT 'solo',
    teacher_ids       VARCHAR(128) NOT NULL DEFAULT '',
    question_type     VARCHAR(32)  NOT NULL DEFAULT '',
    title             VARCHAR(255) NOT NULL DEFAULT '',
    answer_chars      INTEGER      NOT NULL DEFAULT 0,
    deep              INTEGER      NOT NULL DEFAULT 0,
    final_score       FLOAT        NOT NULL DEFAULT 0,
    max_score         FLOAT        NOT NULL DEFAULT 0,
    score_rate        FLOAT        NOT NULL DEFAULT 0,
    elapsed_ms        INTEGER      NOT NULL DEFAULT 0,
    llm_calls         INTEGER      NOT NULL DEFAULT 0,
    prompt_tokens     INTEGER      NOT NULL DEFAULT 0,
    completion_tokens INTEGER      NOT NULL DEFAULT 0,
    disputed          INTEGER      NOT NULL DEFAULT 0,
    status            VARCHAR(16)  NOT NULL DEFAULT 'success',
    error             VARCHAR(500) NOT NULL DEFAULT '',
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_grading_tasks_task_id    ON grading_tasks (task_id);
CREATE INDEX IF NOT EXISTS ix_grading_tasks_created_at ON grading_tasks (created_at);

CREATE TABLE IF NOT EXISTS llm_call_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id           VARCHAR(32)  NOT NULL DEFAULT '',
    teacher_id        VARCHAR(32)  NOT NULL DEFAULT '',
    stage             VARCHAR(32)  NOT NULL DEFAULT 'grade',
    model             VARCHAR(64)  NOT NULL DEFAULT '',
    prompt_chars      INTEGER      NOT NULL DEFAULT 0,
    output_chars      INTEGER      NOT NULL DEFAULT 0,
    prompt_tokens     INTEGER      NOT NULL DEFAULT 0,
    completion_tokens INTEGER      NOT NULL DEFAULT 0,
    elapsed_ms        INTEGER      NOT NULL DEFAULT 0,
    ok                INTEGER      NOT NULL DEFAULT 1,
    error             VARCHAR(500) NOT NULL DEFAULT '',
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_llm_call_logs_task_id    ON llm_call_logs (task_id);
CREATE INDEX IF NOT EXISTS ix_llm_call_logs_created_at ON llm_call_logs (created_at);
"#;

/// 建库建表。在 `setup` 里调一次。
///
/// ⚠️ 失败**只记日志、不中断启动**：记账是附加能力，写不进去不该让人没法批改。
pub fn init() {
    if DB.get().is_some() {
        return;
    }
    let opened = (|| -> Result<Connection, String> {
        paths::ensure_dir(&paths::data_dir()).map_err(|e| format!("建 data/ 失败：{e}"))?;
        let conn =
            Connection::open(paths::db_path()).map_err(|e| format!("打开库失败：{e}"))?;
        conn.execute_batch(SCHEMA).map_err(|e| format!("建表失败：{e}"))?;
        Ok(conn)
    })();

    match opened {
        Ok(conn) => {
            // 并发下 set 只会成功一次；被丢弃的那份连接没被使用，无害。
            let _ = DB.set(Mutex::new(conn));
            log::info!("[蓝笔] 记账库就绪：{}", paths::db_path().display());
        }
        Err(e) => log::error!("[蓝笔] 记账库不可用（批改不受影响，但不会记账）：{e}"),
    }
}

fn conn() -> Result<MutexGuard<'static, Connection>, String> {
    let m = DB
        .get()
        .ok_or_else(|| "记账库未就绪（ENABLE_PERSISTENCE 等价于关闭）".to_string())?;
    m.lock()
        .map_err(|_| "记账库被上一处 panic 锁死了".to_string())
}

// ─────────────────────────── 取值小工具 ───────────────────────────
//
// 前端传的是 JSON，字段可能有缺失/类型不对。这里一律**宽容取默认值**而不是报错：
// 一条记录少个 title 不该让整次批改的记账失败。

fn s_of(v: &Value, k: &str) -> String {
    v.get(k)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

fn i_of(v: &Value, k: &str) -> i64 {
    v.get(k)
        .and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64)))
        .unwrap_or(0)
}

fn f_of(v: &Value, k: &str) -> f64 {
    v.get(k)
        .and_then(|x| x.as_f64().or_else(|| x.as_i64().map(|i| i as f64)))
        .unwrap_or(0.0)
}

fn b_of(v: &Value, k: &str) -> bool {
    v.get(k).and_then(|x| x.as_bool()).unwrap_or(false)
}

/// 按**字符**截断（不是字节）—— 按字节切会切坏 UTF-8 尾部，写库时直接报错。
fn cut(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        s.chars().take(max_chars).collect()
    }
}

fn join_ids(v: Option<&Value>) -> String {
    match v.and_then(|x| x.as_array()) {
        Some(arr) => arr
            .iter()
            .filter_map(|x| x.as_str())
            .collect::<Vec<_>>()
            .join(","),
        None => String::new(),
    }
}

// ─────────────────────────── grading_tasks ───────────────────────────

/// 任务汇总的对外形态。字段与 Python 的 `GradingTaskOut` 一一对应 ——
/// 前端按这些名字读，少一个就是 `undefined`，不会报错但界面会空。
fn row_to_json(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id":                 r.get::<_, i64>(0)?,
        "task_id":            r.get::<_, String>(1)?,
        "mode":               r.get::<_, String>(2)?,
        "teacher_ids":        r.get::<_, String>(3)?,
        "question_type":      r.get::<_, String>(4)?,
        "title":              r.get::<_, String>(5)?,
        "answer_chars":       r.get::<_, i64>(6)?,
        "deep":               r.get::<_, i64>(7)?,
        "final_score":        r.get::<_, f64>(8)?,
        "max_score":          r.get::<_, f64>(9)?,
        "score_rate":         r.get::<_, f64>(10)?,
        "elapsed_ms":         r.get::<_, i64>(11)?,
        "llm_calls":          r.get::<_, i64>(12)?,
        "prompt_tokens":      r.get::<_, i64>(13)?,
        "completion_tokens":  r.get::<_, i64>(14)?,
        "disputed":           r.get::<_, i64>(15)?,
        "status":             r.get::<_, String>(16)?,
        "error":              r.get::<_, String>(17)?,
        "created_at":         r.get::<_, String>(18)?,
    }))
}

const TASK_COLS: &str = "id, task_id, mode, teacher_ids, question_type, title, answer_chars, \
     deep, final_score, max_score, score_rate, elapsed_ms, llm_calls, prompt_tokens, \
     completion_tokens, disputed, status, error, created_at";

/// 保存一次批改任务。同 `task_id` 重复提交**返回已有那条**（幂等）。
pub fn save_task(p: &Value) -> Result<Value, String> {
    let c = conn()?;
    let task_id = s_of(p, "task_id");
    if task_id.trim().is_empty() {
        return Err("task_id 不能为空".to_string());
    }

    if let Some(existing) = find_task(&c, &task_id)? {
        return Ok(existing);
    }

    let max_score = f_of(p, "max_score");
    let final_score = f_of(p, "final_score");
    let rate = if max_score != 0.0 {
        final_score / max_score
    } else {
        0.0
    };
    let status = {
        let s = s_of(p, "status");
        if s.is_empty() {
            "success".to_string()
        } else {
            s
        }
    };

    c.execute(
        "INSERT INTO grading_tasks (task_id, mode, teacher_ids, question_type, title, \
         answer_chars, deep, final_score, max_score, score_rate, elapsed_ms, llm_calls, \
         prompt_tokens, completion_tokens, disputed, status, error) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
        params![
            task_id,
            {
                let m = s_of(p, "mode");
                if m.is_empty() {
                    "solo".to_string()
                } else {
                    m
                }
            },
            join_ids(p.get("teacher_ids")),
            s_of(p, "question_type"),
            cut(&s_of(p, "title"), 255),
            i_of(p, "answer_chars"),
            if b_of(p, "deep") { 1 } else { 0 },
            final_score,
            max_score,
            // 与 Python 版一致：保留 4 位小数
            (rate * 10000.0).round() / 10000.0,
            i_of(p, "elapsed_ms"),
            i_of(p, "llm_calls"),
            i_of(p, "prompt_tokens"),
            i_of(p, "completion_tokens"),
            if b_of(p, "disputed") { 1 } else { 0 },
            status,
            cut(&s_of(p, "error"), 500),
        ],
    )
    .map_err(|e| format!("写任务失败：{e}"))?;

    let id = c.last_insert_rowid();
    let mut stmt = c
        .prepare(&format!("SELECT {TASK_COLS} FROM grading_tasks WHERE id = ?1"))
        .map_err(|e| e.to_string())?;
    stmt.query_row(params![id], |r| row_to_json(r))
        .map_err(|e| format!("回读任务失败：{e}"))
}

fn find_task(c: &Connection, task_id: &str) -> Result<Option<Value>, String> {
    let mut stmt = c
        .prepare(&format!(
            "SELECT {TASK_COLS} FROM grading_tasks WHERE task_id = ?1"
        ))
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![task_id]).map_err(|e| e.to_string())?;
    match rows.next().map_err(|e| e.to_string())? {
        Some(r) => Ok(Some(row_to_json(r).map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

pub fn get_task(task_id: &str) -> Result<Option<Value>, String> {
    // 先把 guard 绑到变量上再借用：`find_task(&conn()?, …)` 这种写法里
    // `&` 与 `?` 的临时值会让解引用转换失效（实测编译不过）
    let c = conn()?;
    find_task(&c, task_id)
}

pub fn list_tasks(limit: i64, offset: i64) -> Result<Vec<Value>, String> {
    let c = conn()?;
    let mut stmt = c
        .prepare(&format!(
            "SELECT {TASK_COLS} FROM grading_tasks \
             ORDER BY created_at DESC, id DESC LIMIT ?1 OFFSET ?2"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit, offset], |r| row_to_json(r))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn delete_task(task_id: &str) -> Result<bool, String> {
    let c = conn()?;
    let n = c
        .execute("DELETE FROM grading_tasks WHERE task_id = ?1", params![task_id])
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

// ─────────────────────────── llm_call_logs ───────────────────────────

/// 逐次调用的参数。字段多，用结构体传比 10 个位置参数好读。
pub struct CallLog<'a> {
    pub task_id: &'a str,
    pub teacher_id: &'a str,
    pub stage: &'a str,
    pub model: &'a str,
    pub prompt_chars: i64,
    pub output_chars: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub elapsed_ms: i64,
    pub ok: bool,
    pub error: &'a str,
}

/// 记一次 LLM 调用。
///
/// ⚠️ 这是**成本数字的唯一来源** —— 失败时只记日志，绝不向上抛：
/// 记账出问题不该让用户的批改失败（那才是本末倒置）。
pub fn log_llm_call(c: &CallLog<'_>) {
    let result = (|| -> Result<(), String> {
        let db = conn()?;
        db.execute(
            "INSERT INTO llm_call_logs (task_id, teacher_id, stage, model, prompt_chars, \
             output_chars, prompt_tokens, completion_tokens, elapsed_ms, ok, error) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                c.task_id,
                c.teacher_id,
                if c.stage.is_empty() { "grade" } else { c.stage },
                cut(c.model, 64),
                c.prompt_chars,
                c.output_chars,
                c.prompt_tokens,
                c.completion_tokens,
                c.elapsed_ms,
                if c.ok { 1 } else { 0 },
                cut(c.error, 500),
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(e) = result {
        log::warn!("[蓝笔] 调用记账失败（不影响批改）：{e}");
    }
}

// ─────────────────────────── 统计 ───────────────────────────
/// 汇总统计。口径与 `grading_service.build_stats` 相同，对外字段与 `StatsOut` 一致。
pub fn stats() -> Result<Value, String> {
    let c = conn()?;

    let (total_tasks, llm_calls, ptokens, ctokens, avg_rate): (i64, i64, i64, i64, f64) = c
        .query_row(
            "SELECT COUNT(id), COALESCE(SUM(llm_calls),0), COALESCE(SUM(prompt_tokens),0), \
             COALESCE(SUM(completion_tokens),0), COALESCE(AVG(score_rate),0) FROM grading_tasks",
            [],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get::<_, f64>(4)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let mut by_mode = Map::new();
    {
        let mut stmt = c
            .prepare("SELECT mode, COUNT(id) FROM grading_tasks GROUP BY mode")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (m, n) = r.map_err(|e| e.to_string())?;
            by_mode.insert(m, json!(n));
        }
    }

    let mut by_teacher = Map::new();
    {
        // 与 Python 版一致：**按调用次数**记，且排除空 teacher_id（合议阶段的日志没有老师）
        let mut stmt = c
            .prepare(
                "SELECT teacher_id, COUNT(id) FROM llm_call_logs \
                 WHERE teacher_id != '' GROUP BY teacher_id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (t, n) = r.map_err(|e| e.to_string())?;
            by_teacher.insert(t, json!(n));
        }
    }

    let cost = (ptokens as f64 / 1_000_000.0) * PRICE_PROMPT_PER_M
        + (ctokens as f64 / 1_000_000.0) * PRICE_COMPLETION_PER_M;

    Ok(json!({
        "total_tasks":             total_tasks,
        "total_llm_calls":         llm_calls,
        "total_prompt_tokens":     ptokens,
        "total_completion_tokens": ctokens,
        "estimated_cost_cny":      (cost * 10000.0).round() / 10000.0,
        "avg_score_rate":          (avg_rate * 1000.0).round() / 10.0,
        "by_mode":                 Value::Object(by_mode),
        "by_teacher":              Value::Object(by_teacher),
    }))
}

/// 取本地时间字符串（`YYYY-MM-DD HH:MM:SS`）。
///
/// 借 SQLite 的 `datetime('now','localtime')` —— 格式与 `CURRENT_TIMESTAMP` 完全一致，
/// 也就不必为了一个时间戳引一个日期库进来（这个项目的目标是「小包」，每个依赖都值得挑）。
pub fn now_local() -> String {
    conn()
        .and_then(|c| {
            c.query_row("SELECT datetime('now','localtime')", [], |r| {
                r.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())
        })
        .unwrap_or_default()
}
