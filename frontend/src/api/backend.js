// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 后端通道探测与上报
//
// 同一套前端代码要跑在两种环境里：
//   1. 网站版 / 本地开发 —— 有 FastAPI 后端，走 /api/v1（跨域消失、Key 不落浏览器）
//   2. 单文件版发给别人 —— 没有后端，自动降级为浏览器直连 LLM
//
// 靠 /api/v1/health 探测自动切换，用户无感知。
// 另外支持自定义后端地址：单文件版也可以连自己部署的服务器。

const BACKEND_KEY = 'backend_url'
const PROBE_TIMEOUT = 1800

let state = { checked: false, available: false, info: null }

export function getBackendUrl() {
  try {
    return (localStorage.getItem(BACKEND_KEY) || '').trim().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

export function setBackendUrl(url) {
  const v = String(url || '').trim().replace(/\/+$/, '')
  try {
    if (v) localStorage.setItem(BACKEND_KEY, v)
    else localStorage.removeItem(BACKEND_KEY)
  } catch {}
  resetProbe()
}

function resetProbe() {
  state = { checked: false, available: false, info: null }
}

/**
 * 运行时注入的后端地址 —— Tauri 桌面版专用（Rust 侧起的本地服务）。
 *
 * ⚠️ 与 `setBackendUrl` 的关键区别：**这个不写 localStorage**。
 * 桌面版的端口是每次启动由系统分配的（绑 `127.0.0.1:0`，避免和残留实例抢端口），
 * 存下来只会在下次启动时指向一个**错误的端口**。而端口探测失败后前端会静默退回
 * 「浏览器直连」—— 在 Tauri 里那条路会被 CORS 拦死，表现成"批改突然不能用了"，
 * 而且**不会报任何错**。所以它只是内存里的运行时状态。
 */
let runtimeBase = ''

export function setRuntimeBase(url) {
  runtimeBase = String(url || '').trim().replace(/\/+$/, '')
  resetProbe()
}

/**
 * 后端地址。优先级：
 *   ① 用户在设置页手填的（想连自己部署的服务，就尊重他）
 *   ② 运行时注入的（桌面版内置的本地服务）
 *   ③ 相对路径（网站版与后端同源）
 */
export function apiBase() {
  const custom = getBackendUrl()
  if (custom) return `${custom}/api/v1`
  if (runtimeBase) return `${runtimeBase}/api/v1`
  return '/api/v1'
}

export function backendInfo() {
  return state.info
}

export function markBackendDown() {
  state = { checked: true, available: false, info: null }
}

/**
 * 探测后端是否可用。
 * 单文件版（file://）下这个请求会立刻失败，自然降级，不会卡住。
 */
export async function probeBackend({ force = false, timeout = PROBE_TIMEOUT } = {}) {
  if (state.checked && !force) return state.available

  let ok = false
  let info = null
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    const res = await fetch(`${apiBase()}/health`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (res.ok) {
      ok = true
      info = await res.json().catch(() => null)
    }
  } catch {
    ok = false
  }

  state = { checked: true, available: ok, info }
  return ok
}

/** 上报一次批改任务（后端不可用时静默跳过，不影响主流程） */
export async function reportTask(payload) {
  if (!(await probeBackend())) return false
  try {
    const res = await fetch(`${apiBase()}/grading/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 查询服务端是否已托管 LLM 配置。
 * 服务端把 Key 放在 config.json / .env 里，使用者就一个字都不用填。
 * 只回传"是否已配置"，不会回传 Key 本身。
 */
export async function fetchLLMDefault() {
  if (!(await probeBackend())) return null
  try {
    const res = await fetch(`${apiBase()}/settings/llm-default`)
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/**
 * 后端不可用时统一返回 null，调用方据此降级。
 * （记录页会退回浏览器本地存储，批改归档失败也不该影响主流程）
 */
async function apiFetch(path, options = {}) {
  if (!(await probeBackend())) return null
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    if (!res.ok) return null
    return res.status === 204 ? true : await res.json()
  } catch {
    return null
  }
}

// ---------------- 练习记录归档（docs/practice/）----------------

/** 保存一次练习记录到后端（落盘成 docs/practice/*.md + *.json）。 */
export function saveRecordFile(payload) {
  return apiFetch('/records', { method: 'POST', body: JSON.stringify(payload) })
}

/** 拉取归档列表（摘要，不含正文）。 */
export function listRecordFiles(limit = 300) {
  return apiFetch(`/records?limit=${limit}`)
}

/** 拉取单条完整记录（含正文、各老师批注）。 */
export function getRecordFile(id) {
  return apiFetch(`/records/${encodeURIComponent(id)}`)
}

export function deleteRecordFile(id) {
  return apiFetch(`/records/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 取回 markdown 原文（导出用）。 */
export function fetchRecordMarkdown(id) {
  return apiFetch(`/records/${encodeURIComponent(id)}/markdown`)
}

