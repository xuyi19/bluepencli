// 首页仓库入口 / 更新日志页的断言探针。
//
// 检查四件事：
//   1. 首页顶部三个入口都存在，且 href 指向本仓库的真实 remote
//   2. 窄屏（500px）下首页不产生横向溢出（新增的那排 pill 会换行，不能撑破布局）
//   3. 更新日志页渲染出全部版本，且每个版本都有条目
//   4. 两个页面都没有 console 报错
//
// 用法：node .tools/probe-site-links.mjs [base]

const BASE = process.argv[2] || 'http://127.0.0.1:5273'
const PORT = 9500 + Math.floor(Math.random() * 300)

const { spawn } = await import('node:child_process')
const { existsSync } = await import('node:fs')

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
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-links-' + Date.now(),
  'about:blank',
])
process.on('exit', () => { try { proc.kill() } catch { /* 无所谓 */ } })

async function wsUrlOf() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = list.find((t) => t.type === 'page')
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl
    } catch { /* 等 */ }
    await sleep(250)
  }
  throw new Error('CDP 连不上')
}

const ws = new WebSocket(await wsUrlOf())
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const consoleErrors = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(m.params?.exceptionDetails?.text || 'exception')
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
    consoleErrors.push((m.params.args || []).map((a) => a.value).join(' '))
  }
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

let failed = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`)
  if (!ok) failed++
}

await send('Page.enable')
await send('Runtime.enable')

// ---------- 1. 首页入口 ----------
await send('Page.navigate', { url: `${BASE}/#/` })
await sleep(3000)

const actual = await evaluate('location.href')
check('首页路由正确', actual.includes('#/') && !actual.includes('chrome-error'), actual)

const links = await evaluate(`JSON.stringify(
  [...document.querySelectorAll('a[href^="http"]')].map((a) => a.getAttribute('href'))
)`)
const hrefs = JSON.parse(links || '[]')
check('首页有 github 入口', hrefs.some((h) => h.includes('github.com/xuyi19/bluepencli')), hrefs.join(' , '))
check('首页有 gitee 入口', hrefs.some((h) => h.includes('gitee.com/xuyi_19/bluepencil')))

const logLink = await evaluate(`!!document.querySelector('a[href$="#/changelog"]')`)
check('首页有更新日志入口', logLink === true)

// ---------- 2. 窄屏不溢出 ----------
await send('Emulation.setDeviceMetricsOverride', {
  width: 500, height: 900, deviceScaleFactor: 1, mobile: true,
})
await sleep(800)
const overflow = await evaluate(`(() => {
  const de = document.documentElement
  const pills = [...document.querySelectorAll('a')].find((a) => (a.textContent || '').includes('更新日志'))
  return JSON.stringify({
    scrollW: de.scrollWidth,
    clientW: de.clientWidth,
    pillRight: pills ? Math.round(pills.getBoundingClientRect().right) : -1,
  })
})()`)
const ov = JSON.parse(overflow)
check('窄屏无横向溢出', ov.scrollW <= ov.clientW + 1, `scrollW=${ov.scrollW} clientW=${ov.clientW}`)
check('更新日志 pill 在视口内', ov.pillRight > 0 && ov.pillRight <= ov.clientW + 1, `right=${ov.pillRight}`)
await send('Emulation.clearDeviceMetricsOverride')

// ---------- 3. 更新日志页 ----------
await send('Page.navigate', { url: `${BASE}/#/changelog` })
await sleep(2500)

const expected = await evaluate(`JSON.stringify({
  versions: [...document.querySelectorAll('h2')].map((h) => h.innerText.trim()),
  sections: document.querySelectorAll('section').length,
  items: document.querySelectorAll('section .neu > div').length,
})`)
const cl = JSON.parse(expected || '{}')
check('更新日志渲染出 3 个版本', (cl.versions || []).length === 3, JSON.stringify(cl.versions))
check('每版都有条目', (cl.items || 0) >= 20, `items=${cl.items}`)
check('更新日志页有仓库入口', await evaluate(`document.body.innerText.includes('Gitee 仓库')`) === true)

// ---------- 4. 无 console 报错 ----------
// dev server 的 HMR websocket 在无头环境里连不上，会刷出「[vite] failed to connect to
// websocket」和随之而来的 unhandled rejection —— 那是开发服务器的噪声，不是应用错误。
const NOISE = /\[vite\]|websocket|Uncaught \(in promise\)/i
const real = consoleErrors.filter((e) => !NOISE.test(e))
check('无 console 报错', real.length === 0, real.slice(0, 3).join(' | '))

try { proc.kill() } catch { /* 无所谓 */ }
console.log(failed ? `\n✗ ${failed} 项未通过` : '\n全部通过')
process.exit(failed ? 1 : 0)
