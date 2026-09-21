// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// LLM 网关（Rust 版）
//
// ── 为什么桌面版必须有这一层 ──
//   浏览器里前端可以直接 fetch LLM 接口；但 Tauri 的页面跑在 WebView2 里，
//   页面源是 `http://tauri.localhost`，直接 fetch `https://api.deepseek.com/...`
//   就是跨域 —— 而这些厂商的接口**不给浏览器发 CORS 头**（它们只面向服务端），
//   请求会被浏览器拦下。所以桌面版必须由 Rust 侧代发。
//   顺带的好处：Key 不出本机进程、后续记账也有地方落。
//
// ── 与另外两份实现的关系（⚠️ 改一处要改三处）──
//   `build_url` / `build_payload` 在本项目里共有三份：
//     ① 前端 `frontend/src/api/llm.js`（浏览器直连通道）
//     ② Python `backend/app/agents/llm.py`（网站版后端）
//     ③ 本文件（桌面版 Rust 侧）
//   规则必须完全一致，尤其是版本段不能写死 `/v1`：
//   智谱的兼容地址是 `.../paas/v4`，写死会把 `/v1` 又叠上去 → 404。

use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::preset::Preset;

pub const DEFAULT_BASE_URL: &str = "https://api.deepseek.com";
pub const DEFAULT_MODEL: &str = "deepseek-chat";

/// 网关错误。`status` 会被透传给前端（401 无效 Key / 402 余额不足 / 429 太频繁…）
#[derive(Debug, Clone)]
pub struct LlmError {
    pub status: u16,
    pub message: String,
}

impl LlmError {
    pub fn new(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
    /// 前端只认 400/401/402/403/404/408/429/500/502/503，其余一律折成 502
    pub fn http_status(&self) -> u16 {
        let s = if self.status == 0 || self.status >= 500 {
            502
        } else {
            self.status
        };
        match s {
            400 | 401 | 402 | 403 | 404 | 408 | 429 | 500 | 502 | 503 => s,
            _ => 502,
        }
    }
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

// ─────────────────────────── 请求 / 响应契约 ───────────────────────────
// 字段名与 Python 版 `models/schemas.py` 的 ChatRequest / ChatResponse 一致 ——
// 前端只写了一套调用代码，两边都得认。

#[derive(Debug, Clone, Default, Deserialize)]
pub struct LlmConfigIn {
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChatReq {
    pub messages: Vec<Value>,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default)]
    pub json_mode: bool,
    #[serde(default)]
    pub llm_config: Option<LlmConfigIn>,
    #[serde(default)]
    pub task_id: String,
    #[serde(default)]
    pub teacher_id: String,
    #[serde(default = "default_stage")]
    pub stage: String,
}

fn default_temperature() -> f64 {
    0.3
}
fn default_stage() -> String {
    "grade".to_string()
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatResp {
    pub content: String,
    pub model: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub elapsed_ms: i64,
}

/// 解析后的实际配置（前端没填的回退到 presets / 默认值）
#[derive(Debug, Clone)]
pub struct ResolvedConfig {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

/// 前端传的优先，缺的回落 config.json（桌面版零配置就靠这条），再回落默认值。
pub fn resolve_config(got: Option<&LlmConfigIn>, preset: &Preset) -> Result<ResolvedConfig, LlmError> {
    let pick = |front: &str, key: &str, fallback: &str| -> String {
        let f = front.trim();
        if !f.is_empty() {
            return f.to_string();
        }
        let p = preset.get(key).unwrap_or("").trim();
        if !p.is_empty() {
            return p.to_string();
        }
        fallback.to_string()
    };

    let cfg = got.cloned().unwrap_or_default();
    let api_key = pick(&cfg.api_key, "LLM_API_KEY", "");
    if api_key.is_empty() {
        return Err(LlmError::new(
            400,
            "未配置 LLM API Key：请在「设置」页填写，或把 config.json 放在程序同级目录",
        ));
    }
    Ok(ResolvedConfig {
        api_key,
        base_url: pick(&cfg.base_url, "LLM_BASE_URL", DEFAULT_BASE_URL),
        model: pick(&cfg.model, "LLM_MODEL", DEFAULT_MODEL),
    })
}

/// 地址拼接。⚠️ 与前端 `buildUrl`、Python `build_url` 必须逐字一致。
pub fn build_url(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        return base.to_string();
    }
    // 版本段（/v1 /v4 /v2…）用正则等价物判断：末尾是 /v + 数字
    let looks_versioned = match base.rsplit('/').next() {
        Some(seg) => {
            seg.len() >= 2
                && (seg.starts_with('v') || seg.starts_with('V'))
                && seg[1..].chars().all(|c| c.is_ascii_digit())
        }
        None => false,
    };
    if looks_versioned {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/v1/chat/completions")
    }
}

/// 请求体构造。⚠️ 含两条容易漏的规则（与 Python `build_payload` 一致）：
///   · 流式要带 `stream_options.include_usage`，否则上游不回 token 用量，记账就永远是 0；
///   · json_mode 走 `response_format`。
pub fn build_payload(messages: &[Value], model: &str, temperature: f64, stream: bool, json_mode: bool) -> Value {
    let mut p = json!({
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "stream": stream,
    });
    if stream {
        p["stream_options"] = json!({ "include_usage": true });
    }
    if json_mode {
        p["response_format"] = json!({ "type": "json_object" });
    }
    p
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        // 不设总超时：长文批改 + 流式可能跑好几分钟，用连接超时兜底即可
        .connect_timeout(Duration::from_secs(20))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// 从上游错误响应里抠出人能看懂的一句话（各家字段不统一，尽量多试几种）
fn extract_detail(status: u16, body: &str) -> String {
    let short: String = body.chars().take(400).collect();
    if let Ok(v) = serde_json::from_str::<Value>(body) {
        for path in ["/error/message", "/message", "/detail", "/error"] {
            if let Some(s) = v.pointer(path).and_then(|x| x.as_str()) {
                if !s.trim().is_empty() {
                    return s.to_string();
                }
            }
        }
    }
    match status {
        401 => format!("API Key 无效或无权限（401）：{short}"),
        402 => format!("余额不足（402）：{short}"),
        429 => format!("请求过于频繁（429）：{short}"),
        _ => format!("上游返回 {status}：{short}"),
    }
}

fn read_usage(v: &Value) -> (i64, i64) {
    let p = v.pointer("/usage/prompt_tokens").and_then(|x| x.as_i64()).unwrap_or(0);
    let c = v
        .pointer("/usage/completion_tokens")
        .and_then(|x| x.as_i64())
        .unwrap_or(0);
    (p, c)
}

// ─────────────────────────── 非流式 ───────────────────────────

pub async fn forward_once(cfg: &ResolvedConfig, req: &ChatReq) -> Result<ChatResp, LlmError> {
    let url = build_url(&cfg.base_url);
    let body = build_payload(&req.messages, &cfg.model, req.temperature, false, req.json_mode);
    let started = Instant::now();

    let res = client()
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", cfg.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| LlmError::new(0, format!("请求发不出去（{url}）：{e}")))?;

    let status = res.status().as_u16();
    let text = res.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(LlmError::new(status, extract_detail(status, &text)));
    }

    let v: Value = serde_json::from_str(&text)
        .map_err(|e| LlmError::new(502, format!("上游返回的不是合法 JSON：{e}")))?;
    let content = v
        .pointer("/choices/0/message/content")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let model = v
        .get("model")
        .and_then(|x| x.as_str())
        .unwrap_or(&cfg.model)
        .to_string();
    let (pt, ct) = read_usage(&v);

    Ok(ChatResp {
        content,
        model,
        prompt_tokens: pt,
        completion_tokens: ct,
        elapsed_ms: started.elapsed().as_millis() as i64,
    })
}

// ─────────────────────────── 流式 ───────────────────────────

/// 流式产出的每一块内容（已按前端的期望格式包好）
pub enum StreamItem {
    /// 增量文本
    Delta(String),
    /// 上游在最后一块里回的用量（OpenAI 的 include_usage 约定）
    Usage { prompt: i64, completion: i64, model: String },
    /// 出错（以 SSE 事件形式发给前端，前端会抛出）
    Error(String),
}

/// 起一个上游流式请求，把 SSE 逐行解析成 `StreamItem`。
///
/// 返回 `(stream, elapsed_started)`：调用方用它算耗时、做记账。
pub async fn forward_stream(
    cfg: ResolvedConfig,
    req: ChatReq,
) -> Result<impl futures_util::Stream<Item = StreamItem>, LlmError> {
    let url = build_url(&cfg.base_url);
    let body = build_payload(&req.messages, &cfg.model, req.temperature, true, req.json_mode);

    let res = client()
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", cfg.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| LlmError::new(0, format!("请求发不出去（{url}）：{e}")))?;

    let status = res.status().as_u16();
    if !(200..300).contains(&status) {
        let text = res.text().await.unwrap_or_default();
        return Err(LlmError::new(status, extract_detail(status, &text)));
    }

    let mut buf = String::new();
    let model = cfg.model.clone();

    // ⚠️ SSE 的块边界不等于行边界：一个 chunk 可能只到半行，也可能含多行。
    //    必须自己按 '\n' 切、把残行留在 buffer 里 —— 前端 readSSE 是同样的做法。
    let stream = res.bytes_stream().flat_map(move |chunk| {
        let mut out: Vec<StreamItem> = Vec::new();
        let bytes = match chunk {
            Ok(b) => b,
            Err(e) => {
                out.push(StreamItem::Error(format!("读取上游流失败：{e}")));
                return futures_util::stream::iter(out);
            }
        };
        buf.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buf.find('\n') {
            let line: String = buf[..pos].trim().to_string();
            buf.drain(..=pos);
            let payload = match line.strip_prefix("data:") {
                Some(rest) => rest.trim(),
                None => continue,
            };
            if payload.is_empty() || payload == "[DONE]" {
                continue;
            }
            let v: Value = match serde_json::from_str(payload) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Some(msg) = v.pointer("/error/message").and_then(|x| x.as_str()) {
                out.push(StreamItem::Error(msg.to_string()));
                continue;
            }
            let delta = v
                .pointer("/choices/0/delta/content")
                .and_then(|x| x.as_str())
                .unwrap_or("");
            if !delta.is_empty() {
                out.push(StreamItem::Delta(delta.to_string()));
            }
            // 带 include_usage 时，最后一块的 choices 是空数组、只有 usage
            if v.get("usage").map(|u| !u.is_null()).unwrap_or(false) {
                let (p, c) = read_usage(&v);
                let m = v
                    .get("model")
                    .and_then(|x| x.as_str())
                    .unwrap_or(&model)
                    .to_string();
                out.push(StreamItem::Usage {
                    prompt: p,
                    completion: c,
                    model: m,
                });
            }
        }
        futures_util::stream::iter(out)
    });

    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_url_matches_the_other_two_implementations() {
        // 这三条与前端 buildUrl / Python build_url 是同一组用例，改一处就得改三处
        assert_eq!(build_url("https://api.deepseek.com"), "https://api.deepseek.com/v1/chat/completions");
        assert_eq!(build_url("https://api.deepseek.com/v1"), "https://api.deepseek.com/v1/chat/completions");
        // 智谱：带版本段不能再叠 /v1
        assert_eq!(
            build_url("https://open.bigmodel.cn/api/paas/v4"),
            "https://open.bigmodel.cn/api/paas/v4/chat/completions"
        );
        // 已经是完整地址就原样
        assert_eq!(
            build_url("https://x.com/v1/chat/completions"),
            "https://x.com/v1/chat/completions"
        );
        // 尾部斜杠要吃掉
        assert_eq!(build_url("https://x.com/v1/"), "https://x.com/v1/chat/completions");
    }

    #[test]
    fn stream_payload_carries_usage_option() {
        let msgs = vec![json!({"role": "user", "content": "hi"})];
        let p = build_payload(&msgs, "m", 0.2, true, false);
        assert_eq!(p["stream"], true);
        assert_eq!(p["stream_options"]["include_usage"], true);
        assert!(p.get("response_format").is_none());

        let p2 = build_payload(&msgs, "m", 0.2, false, true);
        assert_eq!(p2["response_format"]["type"], "json_object");
        assert!(p2.get("stream_options").is_none());
    }

    #[test]
    fn config_falls_back_to_preset_then_default() {
        let mut pre = Preset::default();
        // 空 preset：没有 Key 就应该报错，而不是发一个没鉴权的请求出去
        assert!(resolve_config(None, &pre).is_err());

        pre = Preset::from_pairs(&[("LLM_API_KEY", "k1"), ("LLM_BASE_URL", "https://p.example")]);
        let c = resolve_config(None, &pre).unwrap();
        assert_eq!(c.api_key, "k1");
        assert_eq!(c.base_url, "https://p.example");
        assert_eq!(c.model, DEFAULT_MODEL);

        // 前端填了就以前端为准
        let front = LlmConfigIn {
            api_key: "k2".into(),
            base_url: String::new(),
            model: "glm-4".into(),
        };
        let c2 = resolve_config(Some(&front), &pre).unwrap();
        assert_eq!(c2.api_key, "k2");
        assert_eq!(c2.base_url, "https://p.example"); // 空的那项仍然回落
        assert_eq!(c2.model, "glm-4");
    }
}
