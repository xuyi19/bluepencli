// 读练习页表单真实状态（textarea 的 value 不在 innerText 里，普通探针看不见）
//
// 用法：node probe-practice-data.mjs <url> [waitMs]
// 输出：题干输入框、作答要求 textarea、给定资料 textarea 的长度与开头，
//       以及题号/题型/来源等元信息 —— 用来确认「真题有没有真的载进来」。

const [url, waitMsRaw] = process.argv.slice(2)
const waitMs = Number(waitMsRaw || 10000)
const PORT = 9344

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
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-probe-data-profile',
  '--window-size=1440,1000',
  'about:blank',
])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function wsUrl() {
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

const ws = new WebSocket(await wsUrl())
await new Promise((r) => (ws.onopen = r))

let id = 0
const pending = new Map()
const logs = []
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result)
    pending.delete(msg.id)
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    logs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  } else if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION: ' + (msg.params.exceptionDetails?.exception?.description || ''))
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

const expr = `(() => {
  const out = {}
  const tas = [...document.querySelectorAll('textarea')]
  out.textareas = tas.map(t => ({
    cls: (t.className || '').slice(0, 40),
    len: t.value.length,
    head: t.value.slice(0, 60).replace(/\\n/g, '⏎'),
  }))
  const inputs = [...document.querySelectorAll('input[type=text], input:not([type])')]
  out.inputs = inputs.map(i => ({ ph: i.placeholder || '', val: (i.value || '').slice(0, 60) }))
  out.picked = [...document.querySelectorAll('button')]
    .filter(b => b.className.includes('neu-inset') && b.className.includes('font-medium'))
    .map(b => b.innerText.trim().slice(0, 30)).slice(0, 12)
  out.bodyHead = document.body.innerText.slice(0, 400)
  return JSON.stringify(out, null, 1)
})()`

const { result } = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
console.log(result?.value || '(空)')

console.log('===== console 报错 =====')
const real = logs.filter((l) => !/\[vite\]|websocket|Uncaught \(in promise\)/i.test(l))
console.log(real.length ? real.slice(0, 10).join('\n') : '（无）')

ws.close()
proc.kill()
process.exit(0)
