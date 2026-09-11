// 窄屏（模拟 500px）验证侧边栏抽屉：关闭态 → 点汉堡 → 打开态。
//
// 用 Emulation.setDeviceMetricsOverride 而不是 --window-size：
// Chrome 有最小窗口宽度（约 500px），改窗口尺寸会被系统裁剪，测不准。

const BASE = 'http://127.0.0.1:5273'
const PORT = 9337
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
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-mobile-profile',
  'about:blank',
])

async function wsUrlOf() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* 等待 */
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
  new Promise((resolve) => {
    const myId = ++id
    pending.set(myId, resolve)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.text)
  return result?.value
}

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r?.data) {
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'))
    console.log(`  截图 ${name}.png`)
  }
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 500, height: 900, deviceScaleFactor: 1, mobile: false,
})

await send('Page.navigate', { url: `${BASE}/#/practice` })
await sleep(3500)

// 关闭态：侧边栏应不可见，汉堡按钮应可见
const closed = await evaluate(`
(() => {
  const aside = document.querySelector('aside')
  const burger = document.querySelector('button[aria-label="打开导航"]')
  const cs = aside ? getComputedStyle(aside) : null
  return {
    侧边栏存在: !!aside,
    侧边栏display: cs?.display || '—',
    汉堡按钮存在: !!burger,
    汉堡按钮可见: burger ? getComputedStyle(burger).display !== 'none' : false,
  }
})()
`)
console.log('关闭态：', JSON.stringify(closed))
await shot('mobile-closed')

// 打开态
const opened = await evaluate(`
(() => {
  const b = document.querySelector('button[aria-label="打开导航"]')
  if (!b) return { clicked: false }
  b.click()
  return { clicked: true }
})()
`)
await sleep(900)
const after = await evaluate(`
(() => {
  const asides = [...document.querySelectorAll('aside')]
  return {
    侧边栏数量: asides.length,
    可见侧边栏: asides.filter(a => getComputedStyle(a).display !== 'none').length,
  }
})()
`)
console.log('打开态：', JSON.stringify({ ...opened, ...after }))
await shot('mobile-open')

ws.close()
proc.kill()
process.exit(0)
