// 首页仓库入口 / 更新日志页的断言探针。
//
// 检查六件事：
//   1. 首页能到达 GitHub / Gitee / 更新日志三个入口，且 href 指向本仓库的真实 remote
//   2. 首页的仓库区块仍自成一块，且排在首页「设置/配置」提示之上（data-testid 定位）
//   3. 窄屏（500px）下不产生横向溢出；日志入口在**抽屉**里够得着
//      —— v0.6.0 起入口挪到了侧边栏底部，窄屏时它就是抽屉。别再回首页找那个胶囊：
//      原来那条断言就是这么写的，从 v0.6.0 起一直在报假失败，而这条探针要起
//      dev server 才跑，于是一路过了六个版本。
//   4. 更新日志页渲染出的版本与仓库根 CHANGELOG.md 完全对应（不写死数量，
//      否则每加一版就要来改这里）
//   5. 日志页的条目**真的可读**：markdown 记号变成了元素、折行的后半句在、缩进子条目在。
//      v0.12.1 之前这三条全不成立，而页面能正常打开 —— 所以只有 1~4 项的话，
//      页面读到一半断句都算"通过"。
//   6. 两个页面都没有 console 报错
//
// 用法：node .tools/probe-site-links.mjs [base]

const BASE = process.argv[2] || 'http://127.0.0.1:5273'
const PORT = 9500 + Math.floor(Math.random() * 300)

const { spawn } = await import('node:child_process')
const { existsSync, readFileSync } = await import('node:fs')
const { dirname, resolve } = await import('node:path')
const { fileURLToPath } = await import('node:url')

// 更新日志的期望值直接读文档，页面若与文档不一致就是回归
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOC_VERSIONS = [
  ...readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8').matchAll(/^##\s+(v[\d.]+)/gm),
].map((m) => m[1])

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
check('首页有更新日志入口', await evaluate(`!!document.querySelector('a[href$="#/changelog"]')`) === true)

// ---------- 2. 入口区块的位置 ----------
// 需求：仓库与日志自成一块，放在「设置/配置」提示之上
const orderRaw = await evaluate(`(() => {
  const repo = document.querySelector('[data-testid="repo-links"]')
  const setup = document.querySelector('[data-testid="setup-hint"]')
  const top = (el) => Math.round(el.getBoundingClientRect().top + window.scrollY)
  return JSON.stringify({
    repo: !!repo,
    setup: !!setup,
    repoTop: repo ? top(repo) : null,
    setupTop: setup ? top(setup) : null,
  })
})()`)
const od = JSON.parse(orderRaw)
check('首页有独立的仓库/日志区块', od.repo === true)
check('入口区块在配置提示之上',
  od.repo === true && od.setup === true && od.repoTop < od.setupTop,
  `repo=${od.repoTop} setup=${od.setupTop}`)

// ---------- 3. 窄屏：不溢出，且日志入口真的够得着 ----------
await send('Emulation.setDeviceMetricsOverride', {
  width: 500, height: 900, deviceScaleFactor: 1, mobile: true,
})
await sleep(800)
const overflow = await evaluate(`(() => {
  const de = document.documentElement
  return JSON.stringify({
    scrollW: de.scrollWidth,
    clientW: de.clientWidth,
    hasBurger: !!document.querySelector('button[aria-label="打开导航"]'),
  })
})()`)
const ov = JSON.parse(overflow)
check('窄屏无横向溢出', ov.scrollW <= ov.clientW + 1, `scrollW=${ov.scrollW} clientW=${ov.clientW}`)
check('窄屏有抽屉入口（汉堡按钮）', ov.hasBurger === true)

// 打开抽屉再量：窄屏下侧边栏是抽屉，不打开的话那个入口根本不在视口里
await evaluate(`(() => {
  document.querySelector('button[aria-label="打开导航"]')?.click()
  return true
})()`)
await sleep(600)
const drawer = await evaluate(`(() => {
  // 同一时刻 DOM 里有两个「日志」入口：桌面侧边栏那个（窄屏是 display:none）和抽屉里的。
  // 只量真正渲染出来的那个 —— 直接 .find() 会拿到前面那个隐藏的，rect 全是 0，
  // 于是断言看着像"入口跑出视口了"，其实是量错了元素。
  const all = [...document.querySelectorAll('a')]
    .filter((x) => (x.getAttribute('href') || '').endsWith('#/changelog'))
  const vis = all
    .map((a) => a.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
  return JSON.stringify({
    total: all.length,
    visible: vis.length,
    rects: vis.map((r) => ({ right: Math.round(r.right), bottom: Math.round(r.bottom) })),
    vw: window.innerWidth,
    vh: window.innerHeight,
  })
})()`)
const dr = JSON.parse(drawer)
check('抽屉里的更新日志入口够得着（在视口内）',
  dr.visible >= 1 && dr.rects.every((r) =>
    r.right > 0 && r.right <= dr.vw + 1 && r.bottom > 0 && r.bottom <= dr.vh + 1),
  JSON.stringify(dr))
await send('Emulation.clearDeviceMetricsOverride')

// ---------- 4. 更新日志页 ----------
await send('Page.navigate', { url: `${BASE}/#/changelog` })
await sleep(2500)

const raw = await evaluate(`JSON.stringify({
  versions: [...document.querySelectorAll('h2')].map((h) => h.innerText.trim()),
  sections: document.querySelectorAll('section').length,
  perVersion: [...document.querySelectorAll('section')].map((s) => s.querySelectorAll('.neu > div').length),
  literalMarkup: document.body.innerText.includes('**错误类型表**'),
  codes: document.querySelectorAll('code').length,
  bolds: document.querySelectorAll('strong').length,
  joinedTail: document.body.innerText.includes('整句照抄'),
  nestedItem: document.body.innerText.includes('口令批次'),
})`)
const cl = JSON.parse(raw || '{}')
check('版本数与 CHANGELOG.md 一致',
  (cl.versions || []).length === DOC_VERSIONS.length,
  `页面 ${(cl.versions || []).length} 个 / 文档 ${DOC_VERSIONS.length} 个`)
check('版本号顺序与文档一致',
  JSON.stringify(cl.versions) === JSON.stringify(DOC_VERSIONS),
  JSON.stringify(cl.versions))
check('每版都有条目', (cl.perVersion || []).every((n) => n > 0), JSON.stringify(cl.perVersion))
check('更新日志页有仓库入口', await evaluate(`document.body.innerText.includes('Gitee 仓库')`) === true)
check('页面标注了数据来源', await evaluate(`document.body.innerText.includes('CHANGELOG.md')`) === true)

// 可读性：这四条是 v0.12.1 补的。之前页面"能打开、版本数也对"，但内容读不了。
check('条目没有把 markdown 记号当文字显示出来',
  cl.literalMarkup === false, '原样显示的会正是 `**错误类型表**` 这一串')
check('加粗与代码渲染成了元素（不是纯文本）',
  cl.codes > 0 && cl.bolds > 0, `code=${cl.codes} strong=${cl.bolds}`)
check('折行的后半句在（原来的截断回归）',
  cl.joinedTail === true)
check('缩进子条目在（原来整条被吞）',
  cl.nestedItem === true)

// ---------- 5. 无 console 报错 ----------
// dev server 的 HMR websocket 在无头环境里连不上，会刷出「[vite] failed to connect to
// websocket」和随之而来的 unhandled rejection —— 那是开发服务器的噪声，不是应用错误。
const NOISE = /\[vite\]|websocket|Uncaught \(in promise\)/i
const real = consoleErrors.filter((e) => !NOISE.test(e))
check('无 console 报错', real.length === 0, real.slice(0, 3).join(' | '))

try { proc.kill() } catch { /* 无所谓 */ }
console.log(failed ? `\n✗ ${failed} 项未通过` : '\n全部通过')
process.exit(failed ? 1 : 0)
