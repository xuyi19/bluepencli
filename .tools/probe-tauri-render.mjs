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
/** `--llm` 会真发一次网络请求（验证转发链路），默认不跑：日常要快、且不依赖网络 */
const WITH_LLM = argv.includes('--llm')
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
          // awaitPromise 必须开：有几条判据要在页面里 await（比如 invoke 本地服务地址）
          params: { expression, returnByValue: true, awaitPromise: true },
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
let page = null
const deadline = Date.now() + 40000
while (Date.now() < deadline) {
  targets = await fetchTargets()
  const list = (targets || []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  // ⚠️ 这里要等的是**两件事**：① WebView2 起来了（有 page target）；
  //    ② 页面**导航完成**（target 的 url 从 about:blank 变成 tauri.localhost）。
  //    两者之间隔着几百毫秒到几秒。抢在前面断言会读到 about:blank，
  //    于是①~⑧全线报红 —— 而那是**探针太急**，不是被测对象坏了。
  //    这一条栽过两次：第一次还误以为是单实例插件的锅，白查一轮。
  page = list.find((t) => t.url && t.url !== 'about:blank') || null
  if (page) break
  await sleep(600)
}
if (!page) {
  // 40 秒都没导航成功 → 退回第一个 target，让下面的断言**去报红**
  // （而不是在这里静默跳过；跳过等于把真故障藏起来）
  page = (targets || []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)[0] || null
}

check('CDP 端口通了（WebView2 已启动）', !!targets, targets ? `${targets.length} 个 target` : '40 秒内没起来')

// ⚠️ 可能有**多个** page target：单实例插件（Windows）会额外创建一个辅助窗口
//    用于跨进程通信，它的 URL 是 `about:blank`。
//    如果只取 targets[0]，很可能连到那个空白辅助窗口上 —— 于是①~⑧全部失败，
//    而真正的主窗口其实好端端的（这个假故障骗过一次，别再用下标取 target 了）。
//    做法：优先选"加载了真实文档"的那个，并把全部 target 打出来备查。
const allPages = (targets || []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl)
console.log(
  `  全部 CDP target：${(targets || []).map((t) => `${t.type}:${t.url || '(无 url)'}`).join(' | ') || '（无）'}`
)
if (allPages.length > 1) {
  console.log(`  页面 target 共 ${allPages.length} 个：${allPages.map((p) => p.url).join(' | ')}`)
}
// page 已在上面（"等导航完成"那一段）选好了。
// 这里只打印诊断信息：出现多个 page target 时，一眼能看出是不是连错了窗口。
console.log(
  `  全部 CDP target：${(targets || []).map((t) => `${t.type}:${t.url || '(无 url)'}`).join(' | ') || '（无）'}`
)
check('拿到页面 target', !!page, page ? `url = ${page.url}` : '')

// ⚠️ 等页面**真正就绪**再往下断言 —— WebView2 起来了 ≠ 页面加载完成了。
//    加了单实例插件之后启动略微变慢，探针"拿到 target 就断言"会读到
//    `about:blank` 或空 DOM，于是①~⑧全线报红 —— 而那是**探针太急**，
//    不是被测对象坏了（实测白查过一轮：改了三处代码才发现只要等一下）。
//    宁可在这里安静地等，也不要让一次真实故障淹没在假红里。
if (page) {
  for (let i = 0; i < 40; i++) {
    const r = await evaluate(
      page.webSocketDebuggerUrl,
      `(document.querySelector('#app') || {}).childElementCount || 0`
    )
    if (r.ok && Number(r.value) > 0) break
    await sleep(500)
  }
}

// ⚠️ CDP target 的 **title 更新滞后于 url**（v0.16.0 实测：url 已经是 tauri.localhost，
//    title 还是 about:blank；而同一时刻 DOM 里的 document.title 已经是对的）。
//    不等这一步，判据② 会**假红**，并让整轮发布被拦下 —— 实际产物是好的
//    （① url 对、③ DOM title 与节点都对）。所以这里单独再等 title，
//    用 `webSocketDebuggerUrl` 认同一个 target，别连错窗口。
if (page) {
  for (let i = 0; i < 20; i++) {
    if (String(page.title || '').includes('蓝笔申论')) break
    const fresh = ((await fetchTargets()) || []).filter(
      (t) => t.type === 'page' && t.webSocketDebuggerUrl
    )
    const same = fresh.find((t) => t.webSocketDebuggerUrl === page.webSocketDebuggerUrl)
    if (same) page = same
    if (String(page.title || '').includes('蓝笔申论')) break
    await sleep(500)
  }
}

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
         html: (document.documentElement.outerHTML || '').slice(0, 220),
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

  // ── 判据⑤：桌面版内置的本地 LLM 网关 ──
  //
  // 这几条是后加的。Rust 侧起了个本地服务来转发 LLM 请求（Tauri 里前端直连会被
  // CORS 拦死）。**服务没起来时界面一切正常，只有点「批改」才失败** ——
  // 正是那种"不看这里就发现不了"的静默故障，所以必须提前钉住。
  //
  // 这一段一次验三件事：
  //   · Tauri command `api_base` 通（端口注入链路）
  //   · 本地服务在监听（把端口要过来再访问它）
  //   · CORS 放行了 tauri.localhost（跨域 fetch 能通才算）
  const apiJson = await evaluate(
    page.webSocketDebuggerUrl,
    `(async () => {
       try {
         const base = await window.__TAURI_INTERNALS__.invoke('api_base')
         if (!base) return JSON.stringify({ ok: false, reason: 'invoke api_base 返回空' })
         const res = await fetch(base + '/api/v1/health', { cache: 'no-store' })
         const body = await res.json().catch(() => null)
         return JSON.stringify({ ok: true, base, status: res.status, body })
       } catch (e) {
         return JSON.stringify({ ok: false, reason: String(e) })
       }
     })()`
  )
  let api = {}
  try {
    api = JSON.parse(apiJson.value || '{}')
  } catch {}

  check('⑤ 取到本地服务地址（Rust 网关已启动）', api.ok === true && !!api.base, api.base || api.reason || '')
  check(
    '⑤ 页面能访问它（CORS 放行了 tauri.localhost）',
    api.status === 200 && !!api.body,
    api.status ? `HTTP ${api.status}` : api.reason || '（没拿到响应）'
  )
  if (api.body) {
    check(
      '⑤ 服务自报身份正确（runtime=tauri）',
      api.body.runtime === 'tauri',
      JSON.stringify(api.body)
    )
    // ⚠️ desktop 必须是 false：Tauri 里关窗口就等于退出进程，不需要
    //    「页面全关就通知后端退出」那套登记；报 true 只会让前端每 20 秒
    //    往不存在的 /session/* 发心跳（全是 404 噪声）。
    check(
      '⑤ desktop 报 false（Tauri 不需要关页即退那套）',
      api.body.desktop === false,
      `desktop = ${api.body.desktop}`
    )
  }

  // ── 判据⑦：设置页要用的端点必须存在 ──
  //
  // ⚠️ 这条是**踩坑之后补的**，理由值得记住：
  //    Rust 网关最早只实现了 health 与 llm/chat，忘了 `/settings/test-llm`。
  //    后果不是报错，而是**设置页点「测试连接」永远失败** ——
  //    前端只会显示一句"测试失败"，用户第一反应是"我 Key 填错了"。
  //    漏一个端点，长得像用户配错了 Key。这类故障必须由探针钉住。
  //
  // 不需要网络：用空 Key 打过去，本地配置解析就该拒绝，返回 200 + `success:false`。
  // 断言的是「端点存在且契约对」（HTTP 200 且返回 JSON），不依赖具体成败。
  if (api.base) {
    for (const [path, method, label] of [
      ['/api/v1/settings/test-llm', 'POST', '测试连接'],
      ['/api/v1/settings/llm-default', 'GET', '服务端托管配置'],
    ]) {
      const r = await (async () => {
        try {
          const res = await fetch(api.base + path, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body:
              method === 'POST'
                ? JSON.stringify({ api_key: '', base_url: '', model: '' })
                : undefined,
          })
          if (res.status !== 200) return { ok: false, why: `HTTP ${res.status}（多半是端点没实现）` }
          const body = await res.json().catch(() => null)
          if (!body) return { ok: false, why: '返回的不是 JSON' }
          return { ok: true, why: JSON.stringify(body).slice(0, 100) }
        } catch (e) {
          return { ok: false, why: String(e) }
        }
      })()
      check(`⑦ 设置页端点 ${path.replace('/api/v1/settings/', '')} 可用（${label}）`, r.ok, r.why)
    }
  }

  // ── 判据⑧：外部链接（仓库地址 / 邮箱）点击后交给系统浏览器 ──
  //
  // Tauri 默认会拦下 `<a target="_blank">` —— 表现是**点仓库地址没反应**，
  // 而这个故障在页面上完全看不出来（没有报错、没有白屏，就是没动静）。
  // 实测由用户报上来才发现。
  //
  // 这里验整条链：点击 → 前端入口的全局拦截 → 调 opener 打开**对应那个** URL。
  // ⚠️ 验法是**把 invoke 临时换成假的** —— 既验了链路，又不会真弹出浏览器窗口
  //    （否则每跑一次探针就开一次 GitHub，探针就没法日常跑了）。
  //    真实调用（含 capabilities 权限）另行手动验一次，别只信这条。
  const linkJson = await evaluate(
    page.webSocketDebuggerUrl,
    `(async () => {
       const a = document.querySelector('a[href*="github.com"], a[href*="gitee.com"]')
       if (!a) return JSON.stringify({ ok: false, reason: '页面上找不到仓库链接' })
       const before = location.href
       const realInternals = window.__TAURI_INTERNALS__
       let opened = null
       // ⚠️ 必须**整个替换** __TAURI_INTERNALS__，不能只改它的 .invoke 属性 ——
       //    Tauri 注入的这个对象上的属性是不可写的，直接赋值会**静默失败**，
       //    于是"链接没被交给 opener"这个假结论就出来了（第一版就栽在这）。
       const fake = Object.create(realInternals)
       fake.invoke = (cmd, args) => {
         if (String(cmd).includes('opener')) {
           opened = (args && args.url) || ''
           return Promise.resolve()
         }
         return realInternals.invoke(cmd, args)
       }
       let mocked = false
       try {
         Object.defineProperty(window, '__TAURI_INTERNALS__', {
           value: fake,
           configurable: true,
           writable: true,
         })
         mocked = window.__TAURI_INTERNALS__ === fake
       } catch (e) {
         // Tauri 把 __TAURI_INTERNALS__ 定义成不可重定义（configurable: false），
         // 所以**mock 装不上是正常现象**，不是被测对象有问题。
          // 这时不点击 —— 真点击会调 opener、真的弹出浏览器，
          // 不该让日常跑的探针有这个副作用。真实点击验证放在 --llm 那一节。
          // ⚠️ 本段整体在 template literal 里，**注释里不能出现反引号** ——
          //    会提前把字符串截断，报"Invalid left-hand side expression in
          //    postfix operation"这种看不出所以然的语法错（真踩过）。
         return JSON.stringify({
           ok: true,
           href: a.getAttribute('href'),
           interactive: false,
           reason: String(e),
         })
       }
       try {
         const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
         a.dispatchEvent(ev)
         await new Promise((r) => setTimeout(r, 400))
         return JSON.stringify({
           ok: true,
           mocked,
           href: a.getAttribute('href'),
           opened,
           prevented: ev.defaultPrevented,
           navigated: location.href !== before,
         })
       } finally {
         try {
           Object.defineProperty(window, '__TAURI_INTERNALS__', {
             value: realInternals,
             configurable: true,
             writable: true,
           })
         } catch {}
       }
     })()`
  )
  let link = {}
  try {
    link = JSON.parse(linkJson.value || '{}')
  } catch {}
  check('⑧ 页面上找得到仓库链接', link.ok === true, link.href || link.reason || '')
  if (link.interactive === false) {
    // ⚠️ 这里**不能**把跳过的项记成通过 —— 那就是假绿（"看着验过了，其实没验"）。
    //    明说跳过，并指向真正会验它的那条路。
    console.log('· ⑧ 点击链路未验（页面里装不上 mock），请跑 `--llm` 做真实点击验证')
  } else {
    check(
      '⑧ 点击被入口拦截处理（默认行为被阻止）',
      link.prevented === true,
      `defaultPrevented = ${link.prevented}`
    )
    check(
      '⑧ 链接地址被交给 opener（而不是在窗口里裸跳）',
      !!link.opened && link.opened === link.href,
      `opened = ${link.opened || '（没被调用）'}`
    )
    check(
      '⑧ 页面没有自己导航走（没有在 WebView 内打开外站）',
      link.navigated === false,
      `navigated = ${link.navigated}`
    )
  }

  // ── 判据⑨：单实例 —— 双击第二次不该再起一个进程 ──
  //
  // 为什么这条值得钉：两个实例会抢同一份 WebView2 数据目录
  // （`%LOCALAPPDATA%\<identifier>\EBWebView`），后者初始化不出页面。
  // 用户看到的现象是**"双击了但什么都没发生"** —— 而这个现象在开发期
  // 把人骗过一次：反复起停做验证时，我以为是探针坏了，查了半天才发现是抢目录。
  //
  // 期望：第二个进程起来后很快自己退出（单实例插件把它拦下，并把已有窗口唤到前面）。
  const second = spawn(exe, [], { stdio: 'ignore' })
  let secondExited = false
  second.on('exit', () => {
    secondExited = true
  })
  await sleep(3500)
  check(
    '⑨ 第二次启动自己退出了（单实例生效，不会抢 WebView2 数据目录）',
    secondExited,
    secondExited ? '第二个进程已退出' : '⚠️ 第二个进程还活着 —— 单实例没生效'
  )
  if (!secondExited) {
    try {
      second.kill('SIGKILL')
    } catch {}
  }

  // ── 判据⑥（只在 `--llm` 时跑）：转发链路真的通到上游 ──
  //
  // 为什么单独开关：它会**真发一次网络请求**。日常跑探针要快、不能依赖网络；
  // 但改完 `llm.rs` / `server.rs` 之后，这是唯一能证明"请求真的发出去了"的证据 ——
  // 只看健康检查的话，一个把请求吞掉、永远返回 500 的网关同样是"绿的"。
  //
  // 从 Node 侧直接打本地服务（不经过页面），这样测的是网关本身，
  // 不掺 CORS 的因素（CORS 已由判据⑤单独覆盖）。
  if (WITH_LLM && api.base) {
    const post = async (payload) => {
      try {
        const res = await fetch(`${api.base}/api/v1/llm/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        return { status: res.status, body: await res.json().catch(() => null) }
      } catch (e) {
        return { status: 0, error: String(e) }
      }
    }

    // ① 没配 Key：本地就该拒绝，不该白白发一个没有鉴权的请求出去
    const noKey = await post({
      messages: [{ role: 'user', content: 'hi' }],
      llm_config: { api_key: '', base_url: '', model: '' },
    })
    check(
      '⑥ 没配 Key 时本地直接拒绝（不白发请求）',
      noKey.status === 400,
      `HTTP ${noKey.status} —— ${JSON.stringify(noKey.body || noKey.error || {}).slice(0, 120)}`
    )

    // ② 假 Key：能拿到**上游**的拒绝，说明请求确实转发到了 LLM。
    //    401 = 上游说不认这个 Key（理想结果）；
    //    502 = 上游连不通（网络问题），也说明转发动作发生了、不是被本机吞掉。
    const fake = await post({
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0,
      llm_config: {
        api_key: 'sk-invalid-key-for-probe',
        base_url: 'https://api.deepseek.com',
        model: 'deepseek-chat',
      },
    })
    check(
      '⑥ 假 Key 得到上游的回应（401/502），证明转发真的到了 LLM',
      fake.status === 401 || fake.status === 502,
      `HTTP ${fake.status} —— ${JSON.stringify(fake.body || fake.error || {}).slice(0, 140)}`
    )

    // ③ 流式 —— **这才是批改实际走的那条路**。
    //    上面那条假 Key 的测试验不到流式：上游在建立流之前就 401 了。
    //    所以这里用一个本地假 LLM 当上游，把「流式转发 → delta 透传 → [DONE] 收尾」
    //    整条链跑通，而且不需要任何真 Key。
    const mockPort = 9700 + Math.floor(Math.random() * 200)
    const mock = spawn(process.execPath, [join(ROOT, '.tools', 'mock-llm.mjs'), String(mockPort)], {
      stdio: 'ignore',
    })
    try {
      let up = false
      for (let i = 0; i < 30 && !up; i++) {
        try {
          const r = await fetch(`http://127.0.0.1:${mockPort}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
          up = !!r.status
        } catch {
          await sleep(300)
        }
      }
      check('⑥ 本地假 LLM 已就绪', up, `http://127.0.0.1:${mockPort}`)

      if (up) {
        const res = await fetch(`${api.base}/api/v1/llm/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: '随便写一段' }],
            llm_config: {
              api_key: 'mock-key',
              base_url: `http://127.0.0.1:${mockPort}/v1`,
              model: 'mock-model',
            },
          }),
        })
        const text = await res.text()
        check(
          '⑥ 流式端点返回 SSE',
          res.status === 200 && text.includes('data:'),
          `HTTP ${res.status}，${text.length} 字节`
        )
        check(
          '⑥ 流里有增量内容（delta 透传链路通）',
          /"delta":\{"content":"[^"]+"/.test(text),
          text.slice(0, 100).replace(/\n/g, ' ')
        )
        check('⑥ 流以 [DONE] 收尾（前端靠它结束读取）', text.includes('[DONE]'))
      }
    } finally {
      try {
        mock.kill('SIGKILL')
      } catch {}
    }

    // ④ 真实点击仓库链接 —— 验证「点击 → 入口拦截 → opener → 系统浏览器」整条链。
    //
    // ⚠️ 这一步**会真的弹出浏览器**，所以只在 `--llm` 下跑（这个开关的含义就是
    //    "允许真实外部副作用"：发真网络请求、开真浏览器）。
    //    判据是**没有报错**：入口拦截器把失败都收进了 console.warn，
    //    所以劫持 console.warn 就能知道 openUrl 有没有抛 —— 不必去观察浏览器本身
    //    （那是探针观察不到的）。
    //    Tauri 把 `__TAURI_INTERNALS__` 锁成了不可重定义，没法 mock invoke，
    //    所以这是唯一能真验这条链路的办法。
    const clickJson = await evaluate(
      page.webSocketDebuggerUrl,
      `(async () => {
         const a = document.querySelector('a[href*="github.com"], a[href*="gitee.com"]')
         if (!a) return JSON.stringify({ ok: false, reason: '页面上找不到仓库链接' })
         const before = location.href
         const warns = []
         const realWarn = console.warn
         console.warn = function () {
           const line = Array.prototype.map.call(arguments, String).join(' ')
           warns.push(line)
           realWarn.apply(console, arguments)
         }
         try {
           const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
           a.dispatchEvent(ev)
           await new Promise((r) => setTimeout(r, 1200))
           return JSON.stringify({
             ok: true,
             href: a.getAttribute('href'),
             prevented: ev.defaultPrevented,
             navigated: location.href !== before,
             fails: warns.filter((w) => w.indexOf('打开外部链接失败') >= 0),
           })
         } finally {
           console.warn = realWarn
         }
       })()`
    )
    let ck = {}
    try {
      ck = JSON.parse(clickJson.value || '{}')
    } catch {}
    check('⑧ 真实点击被入口拦截处理', ck.prevented === true, `defaultPrevented = ${ck.prevented}`)
    check(
      '⑧ 点击后 opener 没报错（插件与 capabilities 权限都通了）',
      ck.ok === true && (ck.fails || []).length === 0,
      (ck.fails || []).join(' | ') || '无警告'
    )
    check('⑧ 真实点击没有让页面在窗口内导航走', ck.navigated === false, `navigated = ${ck.navigated}`)
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
