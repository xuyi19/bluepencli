// 批量对全部路由做「真实等待 + 截图 + 文本校验」。
// 用 CDP 而不是 --virtual-time-budget：后者会冻住 IndexedDB，导致依赖本地数据的页面
// 永远停在 loading，看起来像 bug（实际是截图方式的假象）。

const BASE = process.argv[2] || 'http://127.0.0.1:5273'
const PORT = 9336
const OUT = 'E:/code/bluepencil/.shots'

const ROUTES = [
  ['', 'home', ['蓝笔申论', '累计练习', '更新日志']],
  ['teachers', 'teachers', ['老师']],
  ['questions', 'questions', ['题库']],
  ['articles', 'articles', ['文章库']],
  ['practice', 'practice', ['练习批改', '谁来批改']],
  ['records', 'records', ['复盘']],
  ['stats', 'stats', ['统计']],
  ['settings', 'settings', ['API']],
  ['changelog', 'changelog', ['更新日志', 'GitHub', 'Gitee']],
]

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
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-batch-profile',
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
let failures = 0

for (const [route, name, expects] of ROUTES) {
  await send('Page.navigate', { url: `${BASE}/#/${route}` })
  await sleep(route === 'records' || route === 'stats' || route === '' ? 6000 : 3500)

  const text = await evaluate('document.body.innerText')
  const missing = expects.filter((e) => !text.includes(e))
  // 检查是否有被拆成逐字换行的导航（汉字换行 bug 的回归检查）
  const navBroken = await evaluate(`
    (() => {
      const nav = document.querySelector('nav')
      if (!nav) return 'no-nav'
      const items = [...nav.querySelectorAll('a')]
      const broken = items.filter(a => (a.innerText || '').replace(/\\s/g,'').length > 2 && a.getBoundingClientRect().height > 56)
      return broken.length ? broken.map(b=>b.innerText).join('|') : ''
    })()
  `)

  const ok = !missing.length && !navBroken
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} /${route.padEnd(9)} ${missing.length ? '缺:' + missing.join(',') : ''} ${navBroken ? '导航竖排:' + navBroken : ''}`)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) writeFileSync(`${OUT}/route-${name}.png`, Buffer.from(shot.data, 'base64'))
}

console.log(failures ? `\n${failures} 条路由有问题` : '\n全部路由通过')

ws.close()
proc.kill()
process.exit(0)
