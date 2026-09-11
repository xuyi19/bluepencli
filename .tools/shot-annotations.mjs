// 打开复盘页，等归档记录加载出来，滚到「老师色标批注」区并截图放大看。
// 复用 e2e 留下的 Chrome profile（localStorage 里已有 mock 配置）。

const BASE = 'http://127.0.0.1:5273/#/records'
const PORT = 9335

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
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-e2e-profile',
  '--window-size=1280,1000',
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
await send('Page.navigate', { url: BASE })
await sleep(9000) // 真实等待：IndexedDB + 后端拉取

const info = await evaluate(`
(() => {
  const t = document.body.innerText
  const marked = [...document.querySelectorAll('[style*="background-color"]')].filter(
    (el) => el.title && el.style.paddingBottom
  )
  const colors = new Set(marked.map((m) => m.style.borderBottomColor))
  return {
    有记录: !t.includes('正在读取记录') && !t.includes('还没有练习记录'),
    标题出现: t.includes('养老刚需'),
    色标段落数: marked.length,
    多老师合并段: marked.filter((m) => m.style.backgroundImage.includes('gradient')).length,
    用到的颜色数: colors.size,
    每段批注来源: marked.map((m) => ({
      文本: m.textContent.slice(0, 16),
      tooltip里几位老师: (m.title.match(/｜/g) || []).length,
      渐变: m.style.backgroundImage.includes('gradient'),
    })),
  }
})()
`)
console.log(JSON.stringify(info, null, 2))

// 滚到「老师批注」区
await evaluate(`
(() => {
  const el = [...document.querySelectorAll('span,div')].find(e => e.textContent.trim() === '我的作答 · 老师批注')
  el?.scrollIntoView({ block: 'start' })
  return !!el
})()
`)
await sleep(1200)

const shotRes = await send('Page.captureScreenshot', { format: 'png' })
if (shotRes?.data) {
  writeFileSync('E:/code/bluepencil/.shots/e2e-annotations.png', Buffer.from(shotRes.data, 'base64'))
  console.log('截图：E:/code/bluepencil/.shots/e2e-annotations.png')
}

ws.close()
proc.kill()
process.exit(0)
