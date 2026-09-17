// 护栏：入口的「版本自检」必须**只刷一次**，不能刷不停。
//
// 背景：桌面版每次启动都开同一个地址，浏览器会复用那个早就打开的标签页，
// 页面里的代码可能是好几版之前的 —— 那个页面永远收不到修复。
// 所以在 frontend/index.html 里加了一段自检：问一次 /api/v1/health，
// 发现"页面版本 ≠ 服务端版本"就 location.reload()。
//
// 但自动刷新是把双刃剑：如果判断写错（比如拿页面自己的版本去记账、
// 或者条件恒真），就会变成无限刷新 —— **那比原来的 bug 更糟**，
// 用户看到的是页面疯狂闪烁、什么都点不了。
// 所以这里必须实测两件事：
//   ① 版本不一致时：**刷新一次**，然后停下（不是刷不停）；
//   ② 版本一致时：**一次都不刷**（不能对着正常状态乱刷）。
//
// 做法是自带一个小静态服务器：服务真实 dist，/api 转发给真后端，
// 只把 /api/v1/health 里的 version 换掉 —— 用来制造"页面落后"这个条件。
//
// 用法：
//   node .tools/probe-version-reload.mjs          # 伪造服务端版本 9.9.9 → 应刷 1 次
//   node .tools/probe-version-reload.mjs same     # 不伪造                  → 应刷 0 次
// 需要后端在 8100 上（/api 会转发过去）。

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

const CDP_PORT = 9354
const SRV_PORT = 8362
const API_BASE = 'http://127.0.0.1:8100'
const DIST = 'E:/code/bluepencil/frontend/dist'

const arg = (process.argv[2] || '').trim()
const FAKE = arg === 'same' ? '' : (arg || '9.9.9')

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))
if (!CHROME) { console.error('找不到 Chrome/Edge'); process.exit(1) }
if (!existsSync(DIST)) { console.error(`没有构建产物：${DIST}`); process.exit(1) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
}

let healthHits = 0
const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])

  if (urlPath.startsWith('/api/')) {
    try {
      const r = await fetch(API_BASE + urlPath)
      let body = Buffer.from(await r.arrayBuffer())
      const type = r.headers.get('content-type') || 'application/json'
      if (urlPath === '/api/v1/health') {
        healthHits++
        // 只动这一处：把服务端版本号换掉，制造"页面落后"的条件
        if (FAKE) {
          const json = JSON.parse(body.toString('utf8'))
          json.version = FAKE
          body = Buffer.from(JSON.stringify(json), 'utf8')
        }
      }
      res.writeHead(r.status, { 'content-type': type })
      res.end(body)
    } catch {
      res.writeHead(502, { 'content-type': 'text/plain' })
      res.end('backend down')
    }
    return
  }

  const rel = urlPath === '/' ? '/index.html' : urlPath
  try {
    const buf = readFileSync(join(DIST, normalize(rel)))
    res.writeHead(200, {
      'content-type': MIME[extname(rel).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    res.end(buf)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('404')
  }
})
await new Promise((r) => server.listen(SRV_PORT, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${SRV_PORT}`
console.log(`· 静态服务器 ${BASE}｜${FAKE ? `服务端版本伪造成 v${FAKE}` : '版本不伪造'}`)

const profileDir = join('C:/Windows/Temp', `cdp-ver-${Date.now()}`)
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--window-size=1440,900',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: 'ignore' })

async function targetWs() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch { /* 端口还没起来 */ }
    await sleep(400)
  }
  throw new Error('CDP 端口没起来')
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let id = 0
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const mid = ++id
          pending.set(mid, { res, rej })
          ws.send(JSON.stringify({ id: mid, method, params }))
        })
      },
      close: () => ws.close(),
    })
    ws.onerror = reject
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id)
        pending.delete(m.id)
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
      }
    }
  })
}

const cdp = await connect(await targetWs())
await cdp.send('Runtime.enable')
await cdp.send('Page.enable')
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
})
// 每次文档加载 +1：用它数"到底刷新了几次"
await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { sessionStorage.setItem('__loads', String((Number(sessionStorage.getItem('__loads')) || 0) + 1)) } catch (e) {}`,
})

const STATE = `(() => ({
  loads: Number((() => { try { return sessionStorage.getItem('__loads') } catch (e) { return -1 } })()) || 0,
  navLinks: document.querySelectorAll('a[href^="#/"]').length,
  meta: (document.querySelector('meta[name="app-version"]') || {}).content || '',
}))()`

async function cleanup() {
  cdp.close()
  chrome.kill()
  server.close()
  await sleep(300)
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
}

try {
  await cdp.send('Page.navigate', { url: BASE + '#/' })
  await sleep(3500)
  const a = (await cdp.send('Runtime.evaluate', { expression: STATE, returnByValue: true })).result.value

  // 再等一段时间，看它会不会接着刷下去
  await sleep(7000)
  const b = (await cdp.send('Runtime.evaluate', { expression: STATE, returnByValue: true })).result.value

  console.log(`\n页面自身版本：v${a.meta || '(读不到)'}`)
  console.log(`health 被问过 ${healthHits} 次`)
  console.log(`3.5s 时已加载 ${a.loads} 次 ｜ 10.5s 时 ${b.loads} 次 ｜ 侧边栏入口 ${b.navLinks} 个`)

  let failed = 0
  const check = (label, ok, extra = '') => {
    console.log(`${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
    if (!ok) failed++
  }

  if (FAKE) {
    check('发现版本不一致后刷新了一次', b.loads === 2, `实际 ${b.loads} 次`)
    check('没有陷入无限刷新', b.loads <= 2, `${b.loads} 次后停下`)
  } else {
    check('版本一致时一次都不刷', b.loads === 1, `实际 ${b.loads} 次`)
  }
  check('页面本身正常渲染（侧边栏有入口）', b.navLinks > 0, `${b.navLinks} 个`)

  console.log(`\n结论：${failed === 0 ? '版本自检行为正确' : `${failed} 项不通过`}`)
  await cleanup()
  process.exit(failed ? 1 : 0)
} catch (err) {
  console.error('探针本身出错：', err)
  await cleanup()
  process.exit(2)
}
