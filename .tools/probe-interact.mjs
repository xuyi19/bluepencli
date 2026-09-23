// 通用交互探针：打开页面 → 等页面稳定 → 执行一段浏览器里的 JS → 打印结果。
//
// 为什么要单独一个：很多验证必须「先点一下」才能看到结果（例如题库页展开参考答案
// 才去载入真题正文）。cdp-probe.mjs 只能读页面文本，读不到点击后的状态。
//
// 用法：
//   node probe-interact.mjs <url> <waitMs> "<在页面里执行的表达式>"
//
// 表达式里可以用 await（本脚本会 await 返回值）。返回对象会被 JSON 序列化打印。
// 例：
//   node probe-interact.mjs "http://127.0.0.1:5273/#/questions" 9000 \
//     "(() => { const d = document.querySelector('details'); d.open = true; return new Promise(r => setTimeout(() => r(d.innerText.slice(0,200)), 2500)) })()"

const [url, waitMsRaw, expression] = process.argv.slice(2)
if (!url || !expression) {
  console.error('用法: node probe-interact.mjs <url> <waitMs> "<expression>"')
  process.exit(1)
}
const waitMs = Number(waitMsRaw || 9000)
const PORT = 9355

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
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-probe-interact-' + Date.now(),   // 随机目录：固定 profile 会缓存早前的失败响应（502 时代的动态 import 报错复活）
  '--window-size=1440,1000',
  'about:blank',
])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
    await sleep(250)
  }
  throw new Error('CDP 连不上')
}

const ws = new WebSocket(await getWs())
await new Promise((r) => (ws.onopen = r))

let id = 0
const pending = new Map()
const errors = []
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result)
    pending.delete(msg.id)
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description || 'exception')
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
}
function send(method, params = {}) {
  const myId = ++id
  return new Promise((resolve) => {
    pending.set(myId, resolve)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url })
await sleep(waitMs)

const { result, exceptionDetails } = await send('Runtime.evaluate', {
  expression,
  awaitPromise: true,
  returnByValue: true,
})
if (exceptionDetails) {
  console.log('执行出错:', exceptionDetails.text, exceptionDetails.exception?.description || '')
} else {
  const v = result?.value
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1))
}

const real = errors.filter((l) => !/\[vite\]|websocket|Uncaught \(in promise\)/i.test(l))
console.log('===== 报错 =====')
console.log(real.length ? real.slice(0, 10).join('\n') : '（无）')

ws.close()
proc.kill()
process.exit(0)
