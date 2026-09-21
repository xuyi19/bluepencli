// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// Tauri 桌面版「真的加载了内嵌前端」的探针
//
// ── 为什么必须有这个探针（这不是假设，是踩出来的）──
//   直接 `cargo build --release` 出来的 exe，**不走** tauri.conf.json 的 frontendDist，
//   而是走 devUrl → 打开的是 `http://localhost:5273`。
//   更坑的是：它照样会起 WebView2、进程照样活着、窗口照样在，
//   用「进程存活 + WebView2 有子进程」去判断会得到**全绿**。
//   如果那台机器上恰好开着 dev server，应用看起来"完全正常"——
//   但那是一个**只有开发者本机能跑的包**，发给别人就是一片白。
//   本质与本项目反复复发的「假绿」同源：**看着像通过，其实什么都没测到**。
//
// ── 判据（四条，一条不合格就红）──
//   ① CDP target 的 url 必须是 Tauri 资源协议（`tauri://localhost` /
//      `http://tauri.localhost` / `https://tauri.localhost`），
//      **绝不能是 devUrl**（默认 5273）。这一条是防假绿的核心。
//   ② 页面 title 必须等于 index.html 里的标题 —— 证明加载的是**打包进去的那份文档**。
//   ③ `#app` 下必须有渲染出来的节点 —— 证明 Vue 真的挂载了，不是白屏。
//   ④ 页面不能停在 WebView2 的错误页（title 为 "localhost"/"127.0.0.1" 那种）。
//
// ── 用法 ──
//   node .tools/probe-tauri-render.mjs                  # 自动找 src-tauri/target/release 下的 exe
//   node .tools/probe-tauri-render.mjs --exe <路径>      # 指定 exe（可测已发包的产物）
//   node .tools/probe-tauri-render.mjs --keep            # 跑完不关进程，留着排查
//
// ⚠️ 端口是**随机高位端口**，且启动前拍一次"哪些端口已被占"的基线：
//    项目里已经吃过"探针连到别人残留实例上、还报全绿"的亏。

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

// ── 参数 ──
const argv = process.argv.slice(2)
const getArg = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}
const KEEP = argv.includes('--keep')
const EXE_ARG = getArg('--exe')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `   —— ${detail}` : ''}`)
}

/** index.html 里的标题 —— 判据②拿它当"真正的那份文档"的指纹 */
const EXPECT_TITLE = '蓝笔申论 · 三师圆桌阅卷'

/** 探针专用端口：随机高位，避免撞上别人的实例 */
const CDP_PORT = 9300 + Math.floor(Math.random() * 400)
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`

/** 自动找一个可测的 exe（优先 release 根目录，那里是 tauri build 的产物） */
function findExe() {
  if (EXE_ARG) return resolve(EXE_ARG)
  // 桌面端在 desktop/ 下（v0.14.0 从 frontend/src-tauri 挪出，
  // 理由见 .workbuddy/memory：Rust 项目不该住在前端目录里）
  const dir = join(ROOT, 'desktop', 'src-tauri', 'target', 'release')
  if (!existsSync(dir)) return null
  const candidates = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.exe'))
    .map((f) => join(dir, f))
    .filter((p) => {
      try {
        return statSync(p).isFile()
      } catch {
        return false
      }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return candidates[0] || null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 拉 CDP 的 target 列表（HTTP 端点，不需要 WS） */
async function fetchTargets(timeoutMs = 1200) {
  try {
    const ctl = AbortSignal.timeout(timeoutMs)
    const res = await fetch(`${CDP_URL}/json`, { signal: ctl })
    if (!res.ok) return null
    const list = await res.json()
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

/**
 * 用 CDP 在页面里跑一段 JS。
 * 走 WebSocket（Node 22 内置 WebSocket，不需要额外依赖）。
 */
function evaluate(wsUrl, expression, timeoutMs = 8000) {
  return new Promise((resolvePromise) => {
    let ws
    const timer = setTimeout(() => {
      try {
        ws?.close()
      } catch {}
      resolvePromise({ ok: false, error: 'CDP 求值超时' })
    }, timeoutMs)

    try {
      ws = new WebSocket(wsUrl)
    } catch (e) {
      clearTimeout(timer)
      return resolvePromise({ ok: false, error: String(e) })
    }

    const finish = (payload) => {
      clearTimeout(timer)
      try {
        ws.close()
      } catch {}
      resolvePromise(payload)
    }

    ws.onerror = () => finish({ ok: false, error: 'CDP WebSocket 连接失败' })
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: false },
        })
      )
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
        if (msg.id !== 1) return
        const r = msg.result?.result
        if (msg.result?.exceptionDetails) {
          return finish({ ok: false, error: msg.result.exceptionDetails.text || '页面内抛错' })
        }
        finish({ ok: true, value: r?.value })
      } catch (e) {
        finish({ ok: false, error: String(e) })
      }
    }
  })
}

// ─────────────────────────── 主流程 ───────────────────────────

const exe = findExe()
check('找得到待测 exe', !!exe, exe || '（src-tauri/target/release 下没有 .exe，先跑 tauri build）')
if (!exe) {
  console.log('\nTauri 桌面版渲染探针：1 failed（没有可测产物）')
  process.exit(1)
}
console.log(`  被测产物：${exe}（${(statSync(exe).size / 1048576).toFixed(1)} MB）`)

// 起进程之前先拍基线：这个端口上有没有别人在跑
const before = await fetchTargets(600)
check(
  '探针端口起进程前是干净的（不会认错对象）',
  before === null,
  before ? `⚠️ ${CDP_PORT} 上已有 ${before.length} 个 target —— 可能是残留实例` : `端口 ${CDP_PORT} 空闲`
)

const child = spawn(exe, [], {
  env: {
    ...process.env,
    // 让 WebView2 开 CDP 端口，这样探针能问页面自己"你到底加载了什么"
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
  },
  stdio: 'ignore',
  detached: false,
})

/** 不管后面断言成败，都要把进程收干净 —— 残留实例是本项目历史上的老坑 */
function cleanup() {
  if (KEEP) {
    console.log(`\n（--keep：进程保留，PID ${child.pid}）`)
    return
  }
  try {
    child.kill('SIGKILL')
  } catch {}
  // Windows 上 SIGKILL 不一定收掉由它拉起的 WebView2 子进程，交给系统回收
}

let targets = null
const deadline = Date.now() + 40000
while (Date.now() < deadline) {
  targets = await fetchTargets()
  if (targets?.some((t) => t.type === 'page' && t.webSocketDebuggerUrl)) break
  await sleep(700)
}

check('CDP 端口通了（WebView2 已启动）', !!targets, targets ? `${targets.length} 个 target` : '40 秒内没起来')

const page = targets?.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null
check('拿到页面 target', !!page, page ? `id=${page.id}` : '')

if (page) {
  // ── 判据①：绝对不能是 devUrl ──
  const url = String(page.url || '')
  const isTauriOrigin = /^(tauri|https?):\/\/(tauri\.localhost|localhost)(\/|$)/i.test(url) && /tauri/i.test(url)
  const isDevUrl = /:5273(\/|$)/.test(url)
  check(
    '① 页面来自 Tauri 资源协议，不是 devUrl（防"只有开发者能跑"的假绿）',
    isTauriOrigin && !isDevUrl,
    `url = ${url}`
  )
  if (isDevUrl) {
    console.log('')
    console.log('  ↳ 这几乎一定是用 `cargo build --release` 编的，而不是 `tauri build`。')
    console.log('    前者不会内嵌 frontendDist，只会去连 tauri.conf.json 里的 devUrl。')
    console.log('    请改用：cd frontend && npx tauri build --no-bundle')
  }

  // ── 判据②：标题必须是打包进去的那份文档 ──
  check('② 页面标题是蓝笔申论（加载的是内嵌文档，不是 WebView 错误页）',
    String(page.title || '').includes('蓝笔申论'), `title = ${page.title}`)

  // ── 判据③：Vue 真的挂载了 ──
  const probe = await evaluate(
    page.webSocketDebuggerUrl,
    `(() => {
       const app = document.querySelector('#app')
       const nodes = app ? app.children.length : -1
       return JSON.stringify({
         title: document.title,
         nodes,
         textLen: (document.body && document.body.innerText || '').trim().length,
       })
     })()`
  )
  if (!probe.ok) {
    check('③ 能从页面里取到 DOM 信息', false, probe.error)
  } else {
    let info = {}
    try {
      info = JSON.parse(probe.value)
    } catch {}
    check('③ 能从页面里取到 DOM 信息', true, JSON.stringify(info))
    check('③ #app 已挂载（Vue 渲染出节点，不是白屏）', (info.nodes || 0) > 0, `#app 子节点 = ${info.nodes}`)
    check('③ 页面有可见文字（真的画出来了）', (info.textLen || 0) > 20, `可见文字 ${info.textLen} 字`)
  }
}

// ── 判据④：收尾前确认页面没停在错误页 ──
check(
  '④ 不是 WebView2 的错误页（错误页标题会是 localhost / 127.0.0.1）',
  !/^(localhost|127\.0\.0\.1)$/i.test(String(page?.title || '').trim()),
  `title = ${page?.title ?? '（无）'}`
)

cleanup()

console.log('')
const failed = results.filter((r) => !r.ok)
console.log(`Tauri 桌面版渲染探针：${results.length - failed.length} passed, ${failed.length} failed`)
if (failed.length) console.log('未通过：' + failed.map((f) => f.name).join(' / '))
process.exit(failed.length ? 1 : 0)
