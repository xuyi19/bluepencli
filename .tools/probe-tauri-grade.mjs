// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 桌面版「点一次批改」的完整端到端验证。
//
// ── 与另两个探针的分工 ──
//   · `probe-tauri-render.mjs`  —— 界面真的加载了内嵌前端（防"只有开发者能跑"的假绿）
//   · `probe-tauri-data.mjs`    —— 记账与归档的**接口**能用（用构造数据打）
//   · 本探针                    —— **用户真的点一次批改**，从头走到尾
//
// ── 为什么非要第三个 ──
//   前两个都只验"零件"。而批改这条路上还串着：读配置 → 走 Rust 网关转发 →
//   解析三师 JSON → 合议 → **自动落盘归档** → **自动上报记账**。
//   中间任何一环断了，界面都不会报错（前端对这些是静默降级的），
//   只有真点一次才能发现。而且**这是唯一不需要真 Key 就能验的完整路径**：
//   mock LLM 只影响内容质量，不影响链路正确性。
//
// ── 判据 ──
//   ① 页面走到"批改结果"
//   ② 结果页真有分数与批注
//   ③ **磁盘上真的多了一份记录**（这才是"批完的稿子落成了 markdown"）
//   ④ 记账里真的多了这次任务
//   收尾把测试产生的记录与任务删掉（不污染用户数据）
//
// ── 用法 ──
//   node .tools/probe-tauri-grade.mjs [--exe <路径>] [--keep]

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const argv = process.argv.slice(2)
const getArg = (n) => {
  const i = argv.indexOf(n)
  return i >= 0 ? argv[i + 1] : null
}
const KEEP = argv.includes('--keep')
const EXE_ARG = getArg('--exe')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `   —— ${detail}` : ''}`)
}

const CDP_PORT = 9300 + Math.floor(Math.random() * 400)
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`
const MOCK_PORT = 9800 + Math.floor(Math.random() * 150)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ANSWER = `老吾老，以及人之老。截至2025年末，我国60周岁及以上老年人口已达32338万人，占总人口的23%。庞大的银发群体既是民生保障的重点，也是消费市场新的增长极。然而现实中，很多人把养老产业简单等同于养老院和护理床位，忽视了适老化产品与银发消费的巨大空间。发展银发经济，需以需求为牵引、以供给为支撑、以政策为保障。`

function findExe() {
  if (EXE_ARG) return resolve(EXE_ARG)
  const dir = join(ROOT, 'desktop', 'src-tauri', 'target', 'release')
  if (!existsSync(dir)) return null
  return (
    readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.exe'))
      .map((f) => join(dir, f))
      .filter((p) => {
        try {
          return statSync(p).isFile()
        } catch {
          return false
        }
      })
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || null
  )
}

async function fetchTargets(timeoutMs = 1200) {
  try {
    const res = await fetch(`${CDP_URL}/json`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const list = await res.json()
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

/** 一次性 CDP 调用（每条命令单独开一个 WS —— WebView2 下比长连接稳） */
function cdp(wsUrl, method, params = {}, timeoutMs = 15000) {
  return new Promise((done) => {
    let ws
    const timer = setTimeout(() => {
      try {
        ws?.close()
      } catch {}
      done({ ok: false, error: 'CDP 超时' })
    }, timeoutMs)
    try {
      ws = new WebSocket(wsUrl)
    } catch (e) {
      clearTimeout(timer)
      return done({ ok: false, error: String(e) })
    }
    const finish = (p) => {
      clearTimeout(timer)
      try {
        ws.close()
      } catch {}
      done(p)
    }
    ws.onerror = () => finish({ ok: false, error: 'WS 失败' })
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }))
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
        if (msg.id !== 1) return
        if (msg.result?.exceptionDetails) {
          return finish({ ok: false, error: msg.result.exceptionDetails.text || '页面内抛错' })
        }
        finish({ ok: true, value: msg.result?.result?.value, result: msg.result })
      } catch (e) {
        finish({ ok: false, error: String(e) })
      }
    }
  })
}

const evaluate = (wsUrl, expression, timeoutMs) =>
  cdp(
    wsUrl,
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    timeoutMs
  )

async function api(base, path, options = {}) {
  try {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(20000),
    })
    const text = await res.text()
    try {
      return { ok: res.ok, status: res.status, body: JSON.parse(text) }
    } catch {
      return { ok: res.ok, status: res.status, body: text }
    }
  } catch (e) {
    return { ok: false, status: 0, error: String(e) }
  }
}

// ─────────────────────────── 主流程 ───────────────────────────

const exe = findExe()
if (!exe) {
  console.log('✗ 找不到待测 exe（先跑 cd desktop && npm run build）')
  process.exit(1)
}
console.log(`  被测产物：${exe}（${(statSync(exe).size / 1048576).toFixed(1)} MB）`)

// 起假 LLM：只影响内容质量，不影响链路正确性
const mock = spawn(process.execPath, [join(ROOT, '.tools', 'mock-llm.mjs'), String(MOCK_PORT)], {
  stdio: 'ignore',
  detached: false,
})
await sleep(600)

const child = spawn(exe, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
  },
  stdio: 'ignore',
  detached: false,
})

function killAll() {
  for (const p of [child, mock]) {
    try {
      p.kill('SIGKILL')
    } catch {}
  }
}

let page = null
const deadline = Date.now() + 40000
while (Date.now() < deadline) {
  const targets = await fetchTargets()
  const ready = (targets || []).find((t) => t.type === 'page' && t.url && t.url !== 'about:blank')
  if (ready) {
    page = ready
    break
  }
  await sleep(700)
}
check('页面加载完成', !!page, page?.url || '40 秒内没就绪')
if (!page) {
  killAll()
  console.log('\n桌面版批改端到端：中止（页面没起来）')
  process.exit(1)
}

const WS = page.webSocketDebuggerUrl
const got = await evaluate(WS, `(async () => await window.__TAURI_INTERNALS__.invoke('api_base'))()`)
const BASE = got.ok ? got.value : ''
check('本地网关就绪', !!BASE, BASE || got.error || '')
if (!BASE) {
  killAll()
  console.log('\n桌面版批改端到端：中止（拿不到服务地址）')
  process.exit(1)
}

// 记账基线：批改前有几条任务，用来判断"这次真的记上账了吗"
const statsBefore = await api(BASE, '/stats')
const tasksBefore = statsBefore.ok ? Number(statsBefore.body?.total_tasks || 0) : 0
console.log(`  批改前记账：${tasksBefore} 条任务`)

// ── 1. 注入假 LLM 配置 ──
await evaluate(
  WS,
  `(() => {
     localStorage.setItem('llm_config', JSON.stringify({
       api_key: 'sk-mock',
       base_url: 'http://127.0.0.1:${MOCK_PORT}/v1',
       model: 'mock-model'
     }));
     localStorage.removeItem('backend_url');
     return 'ok'
   })()`
)
// ⚠️ 必须显式 reload：hash 路由下光改 localStorage 不会重载页（JS 上下文不重建，
//    computed 仍持旧值），不 reload 会误判成"配置没生效"。
await cdp(WS, 'Page.reload', { ignoreCache: true }, 20000)
await sleep(5000)

// reload 之后要重新拿一次页面 WS（页面上下文重建了）
{
  const targets = await fetchTargets()
  const ready = (targets || []).find((t) => t.type === 'page' && t.url && t.url !== 'about:blank')
  if (ready) page = ready
}

// ── 2. 进练习页（hash 路由，直接改 hash 即可）──
await evaluate(page.webSocketDebuggerUrl, `location.hash = '#/practice'; 'ok'`)
await sleep(2500)

// ── 3. 填表（Vue 的 v-model 需要原生 setter + input 事件）──
const filled = await evaluate(
  page.webSocketDebuggerUrl,
  `(() => {
     const setVal = (el, v) => {
       if (!el) return false
       const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
       Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v)
       el.dispatchEvent(new Event('input', { bubbles: true }))
       return true
     }
     const ta = [...document.querySelectorAll('textarea')]
     const title = ta.find(t => (t.placeholder||'').includes('自拟题目'))
     const answer = document.querySelector('textarea.grid-paper') || ta.find(t => (t.placeholder||'').includes('作答'))
     const req = ta.find(t => (t.placeholder||'').includes('观点明确'))
     setVal(title, '结合给定资料，围绕「养老刚需也是产业蓝海」自拟题目，写一篇文章')
     setVal(req, '观点明确，结构完整，语言流畅，1000 字左右')
     setVal(answer, ${JSON.stringify(ANSWER)})
     return { title: !!title, req: !!req, answer: !!answer, answerLen: (answer?.value||'').length }
   })()`
)
check('表单填写成功（题干 / 要求 / 方格纸作答）', filled.ok && filled.value?.answer, JSON.stringify(filled.value))

// ── 4. 点「答完了」──
await sleep(1000)
const clicked = await evaluate(
  page.webSocketDebuggerUrl,
  `(() => {
     const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('答完了'))
     if (!btn) return { clicked: false, buttons: [...document.querySelectorAll('button')].map(b=>b.textContent.trim()).slice(0,12) }
     const disabled = btn.disabled
     btn.click()
     return { clicked: true, disabled }
   })()`
)
check('点到了「答完了」按钮（且未被禁用）', clicked.ok && clicked.value?.clicked && !clicked.value?.disabled, JSON.stringify(clicked.value))

// ── 5. 真实等待批改（假 LLM 很快，但三师圆桌是 4 次调用）──
let stage = 'other'
for (let i = 1; i <= 10; i++) {
  await sleep(3000)
  const s = await evaluate(
    page.webSocketDebuggerUrl,
    `(() => {
       const t = document.body.innerText
       return {
         step: t.includes('批改中') ? 'grading' : (t.includes('批改结果') || t.includes('综合结论')) ? 'result' : 'other',
         len: t.length
       }
     })()`
  )
  stage = s.ok ? s.value?.step : 'other'
  console.log(`   [${i * 3}s] ${stage}`)
  if (stage === 'result') break
}
check('① 批改跑到了结果页', stage === 'result', `最终状态 = ${stage}`)

// ── 6. 结果页真有内容 ──
const resultText = await evaluate(page.webSocketDebuggerUrl, `document.body.innerText`)
const text = resultText.ok ? String(resultText.value || '') : ''
check('② 结果页有分数', /[0-9]/.test(text) && text.includes('分'), `正文 ${text.length} 字符`)
check('② 结果页有老师意见（三师各自的批注）', text.includes('袁东') || text.includes('老师'), '')

// ── 7. ★ 关键：磁盘上真的多了一份记录 ──
// 记录落在 **exe 同级** docs/practice/ —— 这正是"批完的稿子落成了 markdown"
const recDir = join(dirname(exe), 'docs', 'practice')
let newRecord = null
for (let i = 0; i < 10 && !newRecord; i++) {
  if (existsSync(recDir)) {
    const files = readdirSync(recDir).filter((f) => f.endsWith('.json'))
    if (files.length) {
      // 取最新的那份
      const latest = files
        .map((f) => ({ f, t: statSync(join(recDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0]
      newRecord = { file: latest.f, dir: recDir }
    }
  }
  if (!newRecord) await sleep(1500)
}
check(
  '③ 批完自动落盘了（exe 同级 docs/practice/ 出现记录）',
  !!newRecord,
  newRecord ? newRecord.file : `目录 ${recDir} 下没有 json（归档没触发？）`
)

// 用接口再确认一次，并顺手把它删掉（不留测试数据）
let cleanedRecord = false
if (newRecord) {
  const mdName = newRecord.file.replace(/\.json$/, '.md')
  check(
    '③ 同时生成了给人读的 .md',
    existsSync(join(recDir, mdName)),
    mdName
  )
  const listed = await api(BASE, '/records?limit=50')
  const newest = listed.ok && Array.isArray(listed.body) ? listed.body[0] : null
  if (newest?.id) {
    const del = await api(BASE, `/records/${encodeURIComponent(newest.id)}`, { method: 'DELETE' })
    cleanedRecord = del.ok
  }
}

// ── 8. ★ 记账真的记上了 ──
const statsAfter = await api(BASE, '/stats')
const tasksAfter = statsAfter.ok ? Number(statsAfter.body?.total_tasks || 0) : 0
check(
  '④ 记账里多了这次批改任务',
  tasksAfter > tasksBefore,
  `批改前 ${tasksBefore} → 批改后 ${tasksAfter}`
)

// 清掉这次的任务（按 task_id 找最新的）
if (tasksAfter > tasksBefore) {
  const list = await api(BASE, '/grading/tasks?limit=50')
  const newest = list.ok && Array.isArray(list.body) ? list.body[0] : null
  if (newest?.task_id) {
    const del = await api(BASE, `/grading/tasks/${encodeURIComponent(newest.task_id)}`, { method: 'DELETE' })
    if (del.ok) console.log(`   （已清理测试任务 ${newest.task_id}）`)
  }
}
if (cleanedRecord) console.log('   （已清理测试记录）')

if (!KEEP) killAll()

const failed = results.filter((r) => !r.ok)
console.log(
  failed.length
    ? `\n桌面版批改端到端：${results.length - failed.length} passed, ${failed.length} failed`
    : `\n桌面版批改端到端：${results.length} 项全部通过`
)
process.exit(failed.length ? 1 : 0)
