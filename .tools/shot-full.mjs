// 整页截图：viewport 截图看不到折叠线以下的内容（题目、材料、方格纸都在下面）。
// 用 CDP 的 captureBeyondViewport 把整页拍下来，配合真实等待（不能用 --virtual-time-budget，
// 它会冻住 IndexedDB，依赖本地数据的页面会一直 loading）。
//
// 用法：node .tools/shot-full.mjs [route] [outName] [base]
//   node .tools/shot-full.mjs practice full-practice
//   node .tools/shot-full.mjs settings full-settings http://127.0.0.1:5280

// ⚠️ 不能用 || 给 ROUTE 兜底：首页的 route 就是空字符串，
//    '' || 'practice' 会得到 'practice' —— 于是"截首页"永远截到练习页。
const ROUTE = process.argv[2] !== undefined ? process.argv[2] : 'practice'
const NAME = process.argv[3] || `full-${ROUTE || 'home'}`
const BASE = process.argv[4] || 'http://127.0.0.1:5273'
// ⚠️ 端口必须每次不同。proc.kill() 在 Windows 上杀不掉 Chrome 的整个进程树，
// 残留实例会继续占着固定端口；下一次运行 spawn 的新 Chrome 绑不上端口，
// 而 wsUrlOf 会连到那个旧实例 —— 于是"截图成功"但拍的是上一页。
const PORT = 9400 + Math.floor(Math.random() * 500)
const OUT = 'E:/code/bluepencil/.shots'

const { spawn } = await import('node:child_process')
const { existsSync, writeFileSync } = await import('node:fs')

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const proc = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  // ⚠️ 每次用独立 profile：复用同一个 user-data-dir 时 Chrome 会恢复上次会话，
  // 于是 /json/list 找到的 page target 还停在旧的 hash 上；
  // 再 Page.navigate 到同源不同 hash 只算同文档跳转，可能拍到上一页的内容。
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-full-' + Date.now(),
  '--window-size=1280,900',
  'about:blank',
])

async function wsUrlOf() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = list.find((t) => t.type === 'page')
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl
    } catch {
      /* 等 */
    }
    await sleep(250)
  }
  throw new Error('CDP 连不上')
}

const ws = new WebSocket(await wsUrlOf())
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result)
    pending.delete(m.id)
  }
}
const send = (method, params = {}) =>
  new Promise((r) => {
    const myId = ++id
    pending.set(myId, r)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
const evaluate = async (expression) => {
  const { result } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return result?.value
}

await send('Page.enable')
await send('Page.navigate', { url: `${BASE}/#/${ROUTE}` })
await sleep(4500)

// 自证：把实际 URL 与页面首行文字打出来，避免"拍到的是上一页"这种假结果
const actualUrl = await evaluate('location.href')
const firstLine = await evaluate('(document.querySelector("h1")?.innerText || document.body.innerText.split("\\n")[0] || "").trim()')
const expectUrl = `${BASE}/#/${ROUTE}`
console.log(`实际 URL：${actualUrl}`)
console.log(`页面标题：${firstLine}`)
if (actualUrl.replace(/\/$/, '') !== expectUrl.replace(/\/$/, '')) {
  console.log(`✗ 路由不符（期望 ${expectUrl}）—— 大概率连到了残留的 Chrome 实例，本次截图作废`)
  ws.close()
  proc.kill()
  process.exit(1)
}

const height = await evaluate('Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)')
console.log(`页面高度：${height}px`)

const shot = await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: true,
  clip: { x: 0, y: 0, width: 1280, height: Math.min(height, 6000), scale: 1 },
})
if (shot?.data) {
  writeFileSync(`${OUT}/${NAME}.png`, Buffer.from(shot.data, 'base64'))
  console.log(`截图：${NAME}.png`)
} else {
  console.log('截图失败')
}

ws.close()
proc.kill()
process.exit(0)
