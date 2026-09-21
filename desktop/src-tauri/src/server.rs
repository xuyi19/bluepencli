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
use std::time::Instant;

use axum::{
    extract::State,
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

use crate::llm::{self, ChatReq, StreamItem};
use crate::preset::Preset;

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
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
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
    match llm::forward_once(&cfg, &req).await {
        Ok(resp) => Json(resp).into_response(),
        Err(e) => err_response(e),
    }
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

    let stream = match llm::forward_stream(cfg, req).await {
        Ok(s) => s,
        Err(e) => return err_response(e),
    };

    let body = stream.filter_map(|item| async move {
        match item {
            StreamItem::Delta(text) => Some(Ok::<Event, Infallible>(
                Event::default().data(
                    json!({ "choices": [{ "delta": { "content": text } }] }).to_string(),
                ),
            )),
            // 出错也走 SSE 事件：前端 readSSE 见到 error 会抛出来，
            // 这样"流到一半失败"和"一开始就失败"在前端是同一条路径
            StreamItem::Error(msg) => Some(Ok(Event::default()
                .data(json!({ "error": { "message": msg } }).to_string()))),
            // token 用量前端不读（它靠拼 delta），这里丢弃。
            // 将来做记账时，在这里落一条 llm_call_logs 即可。
            StreamItem::Usage { .. } => None,
        }
    });

    // ⚠️ 收尾必须补一发 [DONE]：前端靠它（更准确说是靠流关闭）结束读取，
    //    而有些上游在最后一块之后不再发任何东西，转发层要自己兜底。
    let end = futures_util::stream::once(async {
        Ok::<Event, Infallible>(Event::default().data("[DONE]"))
    });

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
