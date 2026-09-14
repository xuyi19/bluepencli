// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
import { apiBase, probeBackend, markBackendDown } from './backend'

const CFG_KEY = 'llm_config'
const DEFAULT_BASE = 'https://api.deepseek.com'

export function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY) || '{}')
  } catch {
    return {}
  }
}

export function saveConfig(cfg) {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg))
}

export function hasApiKey() {
  return !!getConfig().api_key
}

function buildUrl(baseUrl) {
  const base = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
  if (/\/chat\/completions$/.test(base)) return base
  // 兼容 /v1、/v4 这类版本段（智谱的兼容地址是 .../paas/v4）
  if (/\/v\d+$/.test(base)) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

function friendlyError(err, url) {
  const msg = String(err?.message || err)
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    return new Error(
      `请求发不出去（${url}）。最常见的原因是 CORS：该接口不允许浏览器直连。\n` +
        `解决办法：启动后端（后端通道会自动启用），或把 API 地址换成支持跨域的中转地址。`
    )
  }
  return err
}

/** 解析 SSE 流：后端通道与直连通道共用（两者事件格式一致） */
async function readSSE(res, onDelta) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const t = line.trim()
      if (!t || !t.startsWith('data:')) continue
      const payload = t.slice(5).trim()
      if (payload === '[DONE]') continue
      let json
      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }
      if (json?.error) {
        throw new Error(json.error.message || '服务端返回错误')
      }
      const delta = json?.choices?.[0]?.delta?.content || ''
      if (delta) {
        full += delta
        onDelta?.(delta, full)
      }
    }
  }
  return full
}

// ---------------- 通道 A：浏览器直连 LLM（单文件版走这条） ----------------

async function chatDirect({ messages, stream, onDelta, temperature, signal, jsonMode }) {
  const cfg = getConfig()
  if (!cfg.api_key) throw new Error('未配置 API Key，请先到「设置」填写')

  const url = buildUrl(cfg.base_url)
  const body = {
    model: cfg.model || 'deepseek-chat',
    messages,
    temperature,
    stream,
  }
  if (jsonMode) body.response_format = { type: 'json_object' }

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.api_key}`,
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw friendlyError(e, url)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let detail = text
    try {
      detail = JSON.parse(text)?.error?.message || text
    } catch {}
    if (res.status === 401) throw new Error(`API Key 无效或无权限（401）：${detail}`)
    if (res.status === 402) throw new Error(`余额不足（402）：${detail}`)
    if (res.status === 429) throw new Error(`请求过于频繁（429）：${detail}`)
    throw new Error(`请求失败（${res.status}）：${detail}`)
  }

  if (!stream) {
    const data = await res.json()
    return data?.choices?.[0]?.message?.content || ''
  }
  return readSSE(res, onDelta)
}

// ---------------- 通道 B：经后端网关（网站版 / 本地开发走这条） ----------------

async function chatBackend({
  messages,
  stream,
  onDelta,
  temperature,
  signal,
  jsonMode,
  meta,
  onRaw,
}) {
  const cfg = getConfig()
  const url = `${apiBase()}/llm/chat${stream ? '/stream' : ''}`
  const body = {
    messages,
    temperature,
    json_mode: !!jsonMode,
    llm_config: {
      api_key: cfg.api_key || '',
      base_url: cfg.base_url || '',
      model: cfg.model || '',
    },
    task_id: meta.task_id || '',
    teacher_id: meta.teacher_id || '',
    stage: meta.stage || 'grade',
  }

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    // 网络层失败：后端可能挂了，标记降级
    e.__backendDown = true
    throw e
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let detail = text
    try {
      detail = JSON.parse(text)?.detail || text
    } catch {}
    const err = new Error(detail || `后端返回 ${res.status}`)
    err.status = res.status
    err.fromBackend = true
    throw err
  }

  if (!stream) {
    const data = await res.json()
    onRaw?.(data)
    return data?.content || ''
  }
  return readSSE(res, onDelta)
}

// ---------------- 对外统一入口 ----------------

/**
 * 发起一次对话。自动选择通道：
 *   后端可用 → 走后端网关（跨域消失、Key 不落浏览器、可记账）
 *   后端不可用 → 浏览器直连
 *
 * @param {object}  opts
 * @param {Array}   opts.messages
 * @param {boolean} opts.stream
 * @param {Function} opts.onDelta   流式增量回调
 * @param {Function} opts.onRaw     非流式原始响应回调（用于取 token 用量）
 * @param {object}  opts.meta       { task_id, teacher_id, stage } 记账用
 * @param {boolean} opts.preferBackendOnly  仅走后端（后端挂了不降级）
 */
export async function chat(opts) {
  const {
    messages,
    stream = true,
    onDelta,
    onRaw,
    temperature = 0.3,
    signal,
    jsonMode = false,
    meta = {},
    preferBackendOnly = false,
  } = opts

  if (await probeBackend()) {
    try {
      return await chatBackend({
        messages,
        stream,
        onDelta,
        temperature,
        signal,
        jsonMode,
        meta,
        onRaw,
      })
    } catch (e) {
      if (e.name === 'AbortError') throw e
      if (!e.__backendDown) throw e
      markBackendDown()
      if (preferBackendOnly) throw e
      // 落到下面的直连通道
    }
  } else if (preferBackendOnly) {
    throw new Error('后端未连接，请先启动后端服务')
  }

  return chatDirect({ messages, stream, onDelta, temperature, signal, jsonMode })
}

/** 测试连接：优先让后端测（能顺带验证服务端到上游的通路） */
export async function testConnection() {
  const started = Date.now()

  if (await probeBackend()) {
    const cfg = getConfig()
    const res = await fetch(`${apiBase()}/settings/test-llm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: cfg.api_key || '',
        base_url: cfg.base_url || '',
        model: cfg.model || '',
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.success) {
      return {
        ok: true,
        text: data.response,
        ms: data.elapsed_ms ?? Date.now() - started,
        via: 'backend',
      }
    }
    throw new Error(data.error || `测试失败（${res.status}）`)
  }

  const text = await chatDirect({
    messages: [{ role: 'user', content: '回复两个字：正常' }],
    stream: false,
    temperature: 0,
  })
  return { ok: true, text, ms: Date.now() - started, via: 'direct' }
}
