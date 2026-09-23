// 用 Chrome DevTools Protocol 做「真实等待 + 读页面文本」的探针。
//
// 为什么需要它：headless Chrome 的 --virtual-time-budget 会冻结虚拟时间，
// 依赖 IndexedDB / 网络回调的异步流程可能永远不 resolve，于是页面看起来卡住——
// 分不清是代码 bug 还是截图假象。这里用真实时间等待，结论才可信。
//
// 用法：node cdp-probe.mjs <url> <waitMs> [selectorText]

const [url, waitMsRaw, ...rest] = process.argv.slice(2)
const waitMs = Number(waitMsRaw || 8000)
const wantText = rest.join(' ')
const PORT = 9333

const { spawn } = await import('node:child_process')
const { existsSync } = await import('node:fs')

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))

if (!CHROME) {
  console.error('找不到 Chrome/Edge')
  process.exit(1)
}

const proc = spawn(CHROME, [
  '--headless=new',
  '--no-proxy-server',   // localhost 探测绝不能走系统代理（代理 502 会伪装成页面故障）
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-probe-profile',
  'about:blank',
])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* Chrome 还没起来 */
    }
    await sleep(250)
  }
  throw new Error('CDP 连不上')
}

const wsUrl = await targets()
const ws = new WebSocket(wsUrl)
await new Promise((r) => (ws.onopen = r))

let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result)
    pending.delete(msg.id)
  }
}
function send(method, params = {}) {
  const myId = ++id
  return new Promise((resolve) => {
    pending.set(myId, resolve)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
}

awaited: {
  await send('Page.enable')
  await send('Page.navigate', { url })
  await sleep(waitMs) // 真实时间等待，不用 virtual-time

  const { result } = await send('Runtime.evaluate', {
    expression: 'document.body.innerText',
    returnByValue: true,
  })
  const text = result?.value || ''

  console.log('===== 页面文本(' + text.length + ' 字) =====')
  console.log(text.slice(0, 1200))
  console.log('===== 关键词 =====')
  for (const kw of wantText.split('|').filter(Boolean)) {
    console.log((text.includes(kw) ? '✓ ' : '✗ ') + kw)
  }
}

ws.close()
proc.kill()
process.exit(0)
