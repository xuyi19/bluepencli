// 诊断「点侧边栏导航跳不过去」：用真实 Chrome **模拟鼠标点击**（走坐标，不是 element.click()），
// 逐个点侧边栏里的链接，看 hash 变没变、目标页渲染没渲染。
//
// 为什么必须用真实鼠标事件：element.click() 会把事件直接派发给元素，**绕过遮挡**。
// 如果某个入口被别的元素盖住，click() 照样"成功"，真实用户却点不动 —— 那就白测了。
// 所以这里同时记录 elementFromPoint，把"谁盖在上面"直接抓出来。
//
// 用法：
//   node .tools/probe-nav-click.mjs                       # 默认测 http://127.0.0.1:8765
//   node .tools/probe-nav-click.mjs http://127.0.0.1:5273
//   node .tools/probe-nav-click.mjs http://127.0.0.1:8765 日志,题库
//
// 退出码非 0 表示有入口点不动（可直接当回归护栏用）。

import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

const PORT = 9352

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))
if (!CHROME) {
  console.error('找不到 Chrome/Edge')
  process.exit(1)
}

const base = (process.argv[2] || 'http://127.0.0.1:8765').replace(/#.*$/, '')
const wanted = (process.argv[3] || '更新日志').split(',').map((s) => s.trim()).filter(Boolean)

// 视口给足宽度：侧边栏只在 lg 断点以上才显示，窄视口下量到的 rect 全是 0
const VIEWPORT = { width: 1440, height: 900 }

const profileDir = path.join(process.env.TEMP || '/tmp', `cdp-nav-${Date.now()}`)
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--window-size=1440,900',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
  '--allow-file-access-from-files',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targetWs() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch { /* 端口还没起来，继续等 */ }
    await sleep(400)
  }
  throw new Error('CDP 端口没起来')
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    const logs = []
    let id = 0
    ws.onopen = () => resolve({
      logs,
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
        return
      }
      if (m.method === 'Runtime.consoleAPICalled') {
        logs.push({ kind: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') })
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails
        logs.push({ kind: 'exception', text: `${d.text} ${d.exception?.description || ''}`.trim() })
      }
      if (m.method === 'Log.entryAdded') {
        logs.push({ kind: `log:${m.params.entry.level}`, text: m.params.entry.text })
      }
    }
  })
}

/** 读一遍当前页面：hash + 是否渲染出目标页 + 首屏文字 */
const PAGE_STATE = `(() => ({
  hash: location.hash,
  head: (document.body ? document.body.innerText : '').slice(0, 120).replace(/\\n+/g, ' | '),
  hasLogTitle: [...document.querySelectorAll('h1,h2')].some(h => h.innerText.includes('更新日志')),
  versionNodes: document.querySelectorAll('section h2').length,
}))()`

/** 抓侧边栏里所有可见的站内链接 + 它们的遮挡情况 */
const FIND_LINKS = `(() => {
  const out = []
  for (const a of document.querySelectorAll('a[href^="#/"]')) {
    const r = a.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const top = document.elementFromPoint(cx, cy)
    out.push({
      text: a.innerText.trim(),
      href: a.getAttribute('href'),
      x: Math.round(cx), y: Math.round(cy),
      box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      // 点击目标过小：28px 高的小胶囊 + 6px 间隙，点偏一点就落进缝里，表现为"点了没反应"。
      // 这类问题不会报错、页面也不白屏，只能靠量尺寸抓。
      small: r.height < 32 || r.width < 40,
      covered: !(top && (top === a || a.contains(top))),
      coverBy: top && !(top === a || a.contains(top))
        ? top.tagName + (top.className ? '.' + String(top.className).split(' ')[0] : '')
        : null,
    })
  }
  return { viewport: [innerWidth, innerHeight], links: out }
})()`

const cdp = await connect(await targetWs())
await cdp.send('Runtime.enable')
await cdp.send('Log.enable')
await cdp.send('Page.enable')
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false,
})

console.log(`· 打开 ${base} （视口 ${VIEWPORT.width}x${VIEWPORT.height}）`)
await cdp.send('Page.navigate', { url: base + '#/' })
await sleep(3500)

const dump = (await cdp.send('Runtime.evaluate', {
  expression: `JSON.stringify({
    hash: location.hash,
    inner: [innerWidth, innerHeight],
    appChildren: document.querySelector('#app') ? document.querySelector('#app').children.length : -1,
    allAnchors: document.querySelectorAll('a').length,
    hashAnchors: document.querySelectorAll('a[href^="#/"]').length,
    anchors: [...document.querySelectorAll('a')].map(a => {
      const r = a.getBoundingClientRect()
      return a.innerText.trim().slice(0, 6) + '@' + a.getAttribute('href') + '=' + Math.round(r.width) + 'x' + Math.round(r.height)
    }),
    text: (document.body ? document.body.innerText : '(no body)').slice(0, 150),
  })`,
  returnByValue: true,
})).result.value
console.log('===== 渲染诊断 =====')
console.log(dump)

const found = (await cdp.send('Runtime.evaluate', { expression: FIND_LINKS, returnByValue: true })).result.value
console.log('===== 侧边栏可见链接 =====')
for (const l of found.links) {
  const flags = [
    l.covered ? `**被遮挡 by ${l.coverBy}**` : '',
    l.small ? '点击目标偏小' : '',
  ].filter(Boolean).join(' / ')
  console.log(`  ${l.text.slice(0, 10).padEnd(10, '　')} ${l.href.padEnd(14)} ${l.box[2]}x${l.box[3]} ${flags || 'ok'}`)
}
if (!found.links.length) console.log('  (一个可见站内链接都没有 —— 视口太窄或侧边栏没渲染)')

let failed = 0
let warned = 0
for (const name of wanted) {
  const target = found.links.find((l) => l.text === name)
  console.log(`\n===== 点击「${name}」=====`)
  if (!target) {
    console.log('  ✗ 侧边栏里找不到这个入口')
    failed++
    continue
  }
  console.log(`  坐标 ${target.x},${target.y}  尺寸 ${target.box[2]}x${target.box[3]}  ${target.covered ? `被 ${target.coverBy} 盖住` : '未被遮挡'}`)
  if (target.small) {
    console.log('  ⚠ 点击目标偏小（建议 ≥40x32）：点偏一点就会落空，表现为"点了没反应"')
    warned++
  }

  // 真实鼠标点击：按下 + 抬起，走坐标命中测试
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y, button: 'none' })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  await sleep(2000)

  const st = (await cdp.send('Runtime.evaluate', { expression: PAGE_STATE, returnByValue: true })).result.value
  const ok = st.hash === target.href
  console.log(`  ${ok ? '✓' : '✗'} hash = ${st.hash || '(空)'}  （期望 ${target.href}）`)
  console.log(`  版本节点 ${st.versionNodes} ｜ 首屏：${st.head.slice(0, 80)}`)
  if (!ok) failed++

  // 点完回首页，避免上一次的页面状态影响下一次
  await cdp.send('Page.navigate', { url: base + '#/' })
  await sleep(1500)
}

console.log('\n===== 控制台 =====')
if (!cdp.logs.length) console.log('(无报错)')
for (const l of cdp.logs) console.log(`[${l.kind}] ${l.text.slice(0, 300)}`)

console.log(`\n结论：${failed === 0 ? '全部入口可正常跳转' : `${failed} 个入口点不动`}${warned ? ` ｜ ${warned} 个入口点击目标偏小` : ''}`)

cdp.close()
chrome.kill()
await sleep(400)
try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
process.exit(failed === 0 ? 0 : 1)
