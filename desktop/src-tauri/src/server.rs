// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 桌面版内置的本地 HTTP 服务（Rust 版后端）
//
// ── 为什么要起一个真 HTTP 服务，而不是用 Tauri 的 invoke ──
//   前端 `api/backend.js` 本来就有「探测 `/api/v1/health` → 通就用后端通道」的逻辑，
//   而且**已经被 13 个版本验证过**。起一个本地服务意味着：**前端一行逻辑都不用改**
//   （只需把服务地址注入进去），那 11,768 行前端的行为、以及踩过的坑全都保住。
//   用 invoke 则要改前端整套请求层 —— 那是拿已验证的东西去换未验证的。
//
// ── 端口 ──
//   绑 `127.0.0.1:0` 让系统分配，**不写死端口**：
//   写死会和残留实例、以及用户本机其它服务抢端口，而"抢输了"的表现是启动失败或
//   连到别人身上 —— 本项目已经在这类问题上吃过亏（探针认错实例那次）。
//   真实端口通过 Tauri command `api_base` 告诉前端。
//
// ── CORS ──
//   页面源是 `http://tauri.localhost`，与 `http://127.0.0.1:<port>` 不同源，必须放行。
//   ⚠️ 但**只放行 Tauri 自己的源**，不能用 `Any`：服务虽然只监听本机，
//   可任意网页都能通过它用用户填的 Key 发请求（花的是用户的钱）。

use std::convert::Infallible;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderValue, Method, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde_json::{json, Value};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::db::{self, CallLog};
use crate::llm::{self, ChatReq, StreamItem};
use crate::preset::Preset;
use crate::records;

/// 共享给各 handler 的状态
#[derive(Clone)]
pub struct AppCtx {
    pub preset: Preset,
}

pub fn router(preset: Preset) -> Router {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/llm/chat", post(chat))
        .route("/api/v1/llm/chat/stream", post(chat_stream))
        // 设置页用到的两个端点。**漏了它们不会报错，只会让功能静默失效**：
        // 「测试连接」会打 test-llm，404 时前端只能显示"测试失败"，
        // 用户看到的是"api key 有问题"，而其实是端点不存在 —— 实测真踩过一次。
        .route("/api/v1/settings/test-llm", post(test_llm))
        .route("/api/v1/settings/llm-default", get(llm_default))
        // 记账：任务汇总（前端上报）+ 统计聚合
        .route("/api/v1/grading/tasks", post(create_task).get(list_tasks))
        .route(
            "/api/v1/grading/tasks/{task_id}",
            get(get_task).delete(delete_task),
        )
        .route("/api/v1/stats", get(get_stats))
        // 记录归档：批改完落盘成 docs/practice/*.{md,json}
        .route("/api/v1/records", post(create_record).get(list_record_files))
        .route(
            "/api/v1/records/{record_id}",
            get(get_record).delete(delete_record),
        )
        .route("/api/v1/records/{record_id}/markdown", get(record_markdown))
        .layer(cors())
        .with_state(AppCtx { preset })
}

fn cors() -> CorsLayer {
    let origins = [
        HeaderValue::from_static("http://tauri.localhost"),
        HeaderValue::from_static("https://tauri.localhost"),
        HeaderValue::from_static("tauri://localhost"),
    ];
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        // ⚠️ DELETE 不能漏：记录页的「删除」走它。漏了会预检失败，
        //    而失败的表现是"删不掉，但界面也不报错"。
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
}

/// 健康检查。前端 `probeBackend()` 靠它决定走「后端转发」还是「浏览器直连」。
///
/// ⚠️ 这里 `desktop` 报 **false** 是**故意的**，不是漏了：
///   这个字段在前端只有一个用途 —— 决定挂不挂 `utils/desktopSession.js` 那套
///   「页面全关就通知后端退出进程」。那是给 PyInstaller 版用的，因为它靠一个
///   Python 进程保活、需要知道"页面还有没有人"。
///   而 Tauri 版**关掉窗口就是退出进程**，天生满足，不需要这套登记；
///   硬报 true 只会让前端往不存在的 `/session/*` 发请求（每 20 秒一次心跳全是 404）。
///   为免以后有人看到 false 觉得是 bug，这里另给一个 `runtime` 字段表明身份。
async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "app": "蓝笔申论",
        "version": env!("CARGO_PKG_VERSION"),
        "db": "未启用（桌面版暂不落库）",
        "desktop": false,
        "runtime": "tauri",
    }))
}

/// 统一错误体：前端读 `detail`（与 FastAPI 版保持一致）
fn err_response(e: llm::LlmError) -> Response {
    let code = StatusCode::from_u16(e.http_status()).unwrap_or(StatusCode::BAD_GATEWAY);
    (code, Json(json!({ "detail": e.message }))).into_response()
}

async fn chat(State(ctx): State<AppCtx>, Json(req): Json<ChatReq>) -> Response {
    let cfg = match llm::resolve_config(req.llm_config.as_ref(), &ctx.preset) {
        Ok(c) => c,
        Err(e) => return err_response(e),
    };

    // 记账要用的信息先摘出来（req 随后被 move 进 forward_once）
    let task_id = req.task_id.clone();
    let teacher_id = req.teacher_id.clone();
    let stage = req.stage.clone();
    let prompt_chars = prompt_chars_of(&req.messages);

    match llm::forward_once(&cfg, &req).await {
        Ok(resp) => {
            db::log_llm_call(&CallLog {
                task_id: &task_id,
                teacher_id: &teacher_id,
                stage: &stage,
                model: &resp.model,
                prompt_chars,
                output_chars: resp.content.chars().count() as i64,
                prompt_tokens: resp.prompt_tokens,
                completion_tokens: resp.completion_tokens,
                elapsed_ms: resp.elapsed_ms,
                ok: true,
                error: "",
            });
            Json(resp).into_response()
        }
        Err(e) => {
            // 失败也要记：成本账上"调用失败但上游已经按输入计费"是真实存在的，
            // 而且"某位老师总是失败"这种问题只有靠明细才能查出来。
            db::log_llm_call(&CallLog {
                task_id: &task_id,
                teacher_id: &teacher_id,
                stage: &stage,
                model: &cfg.model,
                prompt_chars,
                output_chars: 0,
                prompt_tokens: 0,
                completion_tokens: 0,
                elapsed_ms: 0,
                ok: false,
                error: &e.message,
            });
            err_response(e)
        }
    }
}

/// prompt 的字符数（记账用）。这里只求一个量级，不需要与上游的 token 计数对上。
fn prompt_chars_of(messages: &[Value]) -> i64 {
    messages
        .iter()
        .map(|m| m.to_string().chars().count() as i64)
        .sum()
}

/// SSE 流式转发。
///
/// 输出格式与 FastAPI 版、以及前端 `readSSE` 完全一致：
///   `data: {"choices":[{"delta":{"content":"…"}}]}` … 最后 `data: [DONE]`
/// 所以前端解析代码一行都不用改。
async fn chat_stream(State(ctx): State<AppCtx>, Json(req): Json<ChatReq>) -> Response {
    let cfg = match llm::resolve_config(req.llm_config.as_ref(), &ctx.preset) {
        Ok(c) => c,
        Err(e) => return err_response(e),
    };

    // 记账上下文（req / cfg 随后会被 move 掉，所以先摘出来）
    let task_id = req.task_id.clone();
    let teacher_id = req.teacher_id.clone();
    let stage = req.stage.clone();
    let model_name = cfg.model.clone();
    let prompt_chars = prompt_chars_of(&req.messages);
    let started = Instant::now();
    // `logged` 保证一次流只记一条明细；`out_chars` 累积实际吐出的字符数
    let logged = Arc::new(AtomicBool::new(false));
    let out_chars = Arc::new(AtomicI64::new(0));

    let stream = match llm::forward_stream(cfg, req).await {
        Ok(s) => s,
        Err(e) => {
            db::log_llm_call(&CallLog {
                task_id: &task_id,
                teacher_id: &teacher_id,
                stage: &stage,
                model: &model_name,
                prompt_chars,
                output_chars: 0,
                prompt_tokens: 0,
                completion_tokens: 0,
                elapsed_ms: started.elapsed().as_millis() as i64,
                ok: false,
                error: &e.message,
            });
            return err_response(e);
        }
    };

    let body = {
        let task_id = task_id.clone();
        let teacher_id = teacher_id.clone();
        let stage = stage.clone();
        let model_name = model_name.clone();
        let logged = logged.clone();
        let out_chars = out_chars.clone();
        stream.filter_map(move |item| {
            let task_id = task_id.clone();
            let teacher_id = teacher_id.clone();
            let stage = stage.clone();
            let model_name = model_name.clone();
            let logged = logged.clone();
            let out_chars = out_chars.clone();
            async move {
                match item {
                    StreamItem::Delta(text) => {
                        out_chars.fetch_add(text.chars().count() as i64, Ordering::Relaxed);
                        Some(Ok::<Event, Infallible>(Event::default().data(
                            json!({ "choices": [{ "delta": { "content": text } }] }).to_string(),
                        )))
                    }
                    // 出错也走 SSE 事件：前端 readSSE 见到 error 会抛出来，
                    // 这样"流到一半失败"和"一开始就失败"在前端是同一条路径
                    StreamItem::Error(msg) => {
                        if !logged.swap(true, Ordering::Relaxed) {
                            db::log_llm_call(&CallLog {
                                task_id: &task_id,
                                teacher_id: &teacher_id,
                                stage: &stage,
                                model: &model_name,
                                prompt_chars,
                                output_chars: out_chars.load(Ordering::Relaxed),
                                prompt_tokens: 0,
                                completion_tokens: 0,
                                elapsed_ms: started.elapsed().as_millis() as i64,
                                ok: false,
                                error: &msg,
                            });
                        }
                        Some(Ok(Event::default()
                            .data(json!({ "error": { "message": msg } }).to_string())))
                    }
                    // 用量前端不读（它靠拼 delta），但**记账必须读**：
                    // 成本数字的唯一来源就是这一块。
                    StreamItem::Usage {
                        prompt,
                        completion,
                        model,
                    } => {
                        if !logged.swap(true, Ordering::Relaxed) {
                            let m = if model.is_empty() { model_name.clone() } else { model };
                            db::log_llm_call(&CallLog {
                                task_id: &task_id,
                                teacher_id: &teacher_id,
                                stage: &stage,
                                model: &m,
                                prompt_chars,
                                output_chars: out_chars.load(Ordering::Relaxed),
                                prompt_tokens: prompt,
                                completion_tokens: completion,
                                elapsed_ms: started.elapsed().as_millis() as i64,
                                ok: true,
                                error: "",
                            });
                        }
                        None
                    }
                }
            }
        })
    };

    // ⚠️ 收尾必须补一发 [DONE]：前端靠它（更准确说是靠流关闭）结束读取，
    //    而有些上游在最后一块之后不再发任何东西，转发层要自己兜底。
    //
    //    这里顺带做**记账兜底**：不少兼容实现**根本不在流里回 usage**，
    //    那时若什么都不记，这次调用就会从成本账上凭空消失 ——
    //    宁可 token 记 0，也不能漏掉"发生过一次调用"这件事。
    let end = {
        let logged = logged.clone();
        let out_chars = out_chars.clone();
        futures_util::stream::once(async move {
            if !logged.swap(true, Ordering::Relaxed) {
                db::log_llm_call(&CallLog {
                    task_id: &task_id,
                    teacher_id: &teacher_id,
                    stage: &stage,
                    model: &model_name,
                    prompt_chars,
                    output_chars: out_chars.load(Ordering::Relaxed),
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    elapsed_ms: started.elapsed().as_millis() as i64,
                    ok: true,
                    error: "",
                });
            }
            Ok::<Event, Infallible>(Event::default().data("[DONE]"))
        })
    };

    Sse::new(body.chain(end))
        .keep_alive(KeepAlive::default())
        .into_response()
}

// ─────────────────────────── 设置页 ───────────────────────────

#[derive(Debug, serde::Deserialize)]
struct TestLlmReq {
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    model: String,
}

/// 「测试连接」：前端设置页那个按钮打这里。
///
/// ⚠️ 与其它端点不同，这个**永远返回 HTTP 200**：成败由 body 里的 `success` 表达。
///    前端是这么读的（`api/llm.js::testConnection`）：
///      `if (data.success) { … } else throw new Error(data.error || '测试失败（' + status + '）')`
///    所以失败时要给 200 + `{success:false, error}`，才能把**真正的原因**送到用户眼前；
///    返回 4xx/5xx 的话前端只会退化成一句干巴巴的"测试失败（404）"——
///    实测就踩到过：端点忘了实现，用户看到的是"测试失败"，第一反应是 Key 有问题。
async fn test_llm(State(ctx): State<AppCtx>, Json(req): Json<TestLlmReq>) -> Json<Value> {
    let started = Instant::now();

    let cfg_in = llm::LlmConfigIn {
        api_key: req.api_key,
        base_url: req.base_url,
        model: req.model,
    };
    let cfg = match llm::resolve_config(Some(&cfg_in), &ctx.preset) {
        Ok(c) => c,
        Err(e) => {
            return Json(json!({
                "success": false,
                "elapsed_ms": started.elapsed().as_millis() as i64,
                "error": e.message,
            }))
        }
    };

    let probe = ChatReq {
        messages: vec![json!({ "role": "user", "content": "回复两个字：正常" })],
        temperature: 0.0,
        json_mode: false,
        llm_config: None,
        task_id: String::new(),
        teacher_id: String::new(),
        stage: "test".to_string(),
    };

    match llm::forward_once(&cfg, &probe).await {
        Ok(r) => Json(json!({
            "success": true,
            "model": r.model,
            // 只回一小段：这只是"通不通"的凭据，不是给用户读的内容
            "response": r.content.trim().chars().take(50).collect::<String>(),
            "elapsed_ms": r.elapsed_ms,
        })),
        Err(e) => Json(json!({
            "success": false,
            "elapsed_ms": started.elapsed().as_millis() as i64,
            "error": e.message.chars().take(300).collect::<String>(),
        })),
    }
}

/// 告诉前端"服务端有没有托管 LLM 配置"（桌面版就是 exe 同级的 `config.json`）。
///
/// ⚠️ **只回传"有没有"，绝不回传 Key 本身** —— 与 Python 版同一条规矩：
///    Key 一旦能被前端读出来，就等于发给了浏览器，托管本身也就失去意义了。
async fn llm_default(State(ctx): State<AppCtx>) -> Json<Value> {
    let has_key = ctx
        .preset
        .get("LLM_API_KEY")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    Json(json!({
        "server_key_configured": has_key,
        "base_url": ctx.preset.get("LLM_BASE_URL").unwrap_or(""),
        "model": ctx.preset.get("LLM_MODEL").unwrap_or(""),
    }))
}

// ─────────────────────────── 记账 ───────────────────────────
//
// 这三个端点对应 `backend/app/api/v1/grading.py` 与 `stats.py`。
// 与 Python 版一致：库不可用时返回 503，前端会静默降级（批改照常进行，只是不留账）。

async fn create_task(Json(payload): Json<Value>) -> Response {
    match db::save_task(&payload) {
        Ok(v) => Json(v).into_response(),
        Err(e) => {
            log::warn!("[蓝笔] 任务记账失败：{e}");
            (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "detail": e }))).into_response()
        }
    }
}

#[derive(Debug, serde::Deserialize)]
struct PageQ {
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    offset: Option<i64>,
}

async fn list_tasks(Query(q): Query<PageQ>) -> Response {
    // 与 Python 版同样的夹取：limit ∈ [1,500]，offset ≥ 0
    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);
    match db::list_tasks(limit, offset) {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "detail": e }))).into_response(),
    }
}

async fn get_task(Path(task_id): Path<String>) -> Response {
    match db::get_task(&task_id) {
        Ok(Some(v)) => Json(v).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": "任务不存在" })),
        )
            .into_response(),
        Err(e) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "detail": e }))).into_response(),
    }
}

async fn delete_task(Path(task_id): Path<String>) -> Response {
    match db::delete_task(&task_id) {
        Ok(true) => Json(json!({ "deleted": true, "task_id": task_id })).into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": "任务不存在" })),
        )
            .into_response(),
        Err(e) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "detail": e }))).into_response(),
    }
}

async fn get_stats() -> Response {
    match db::stats() {
        Ok(v) => Json(v).into_response(),
        Err(e) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "detail": e }))).into_response(),
    }
}

// ─────────────────────────── 记录归档 ───────────────────────────
//
// 对应 `backend/app/api/v1/records.py`。批改完成后前端把完整快照发过来，
// 这里落盘成 `docs/practice/<日期>-<标题>-<id>.{md,json}`。

async fn create_record(Json(mut payload): Json<Value>) -> Response {
    // 与 Python 版一致：前端没带 created_at 时补一个本地时间。
    // 少了这步，文件名会退化成 `0000-00-00-...`，而那是**静默的** ——
    // 用户只会发现记录按日期排得乱七八糟。
    let has_created = payload
        .get("created_at")
        .and_then(|x| x.as_str())
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    if !has_created {
        let now = db::now_local();
        if !now.is_empty() {
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("created_at".to_string(), Value::String(now));
            }
        }
    }

    match records::save(&payload) {
        Ok(v) => Json(v).into_response(),
        Err(e) => {
            log::warn!("[蓝笔] 记录归档失败：{e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "detail": e })),
            )
                .into_response()
        }
    }
}

async fn list_record_files(Query(q): Query<PageQ>) -> Response {
    let limit = q.limit.unwrap_or(100).clamp(1, 500) as usize;
    let offset = q.offset.unwrap_or(0).max(0) as usize;
    Json(records::list_records(limit, offset)).into_response()
}

async fn get_record(Path(record_id): Path<String>) -> Response {
    match records::get_record(&record_id) {
        Some(v) => Json(v).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": "记录不存在" })),
        )
            .into_response(),
    }
}

async fn record_markdown(Path(record_id): Path<String>) -> Response {
    match records::markdown_of(&record_id) {
        Some(md) => Json(json!({ "id": record_id, "markdown": md })).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": "记录不存在" })),
        )
            .into_response(),
    }
}

async fn delete_record(Path(record_id): Path<String>) -> Response {
    if records::delete_record(&record_id) {
        Json(json!({ "deleted": true, "id": record_id })).into_response()
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(json!({ "detail": "记录不存在" })),
        )
            .into_response()
    }
}
