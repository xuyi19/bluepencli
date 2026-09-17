// 诊断「更新日志」页面：用真实 Chrome 打开指定 URL（file:// 或 http://），
// 收集控制台报错 + 未捕获异常 + 实际渲染出来的文本，判断是数据没了还是渲染炸了。
//
// 用法（不带参数时自动挑 release/ 里最新的单文件版）：
//   node .tools/probe-changelog.mjs
//   node .tools/probe-changelog.mjs "file:///E:/code/bluepencil/release/xxx.html"
//   node .tools/probe-changelog.mjs http://127.0.0.1:5273

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PORT = 9351

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

function latestSingleUrl() {
  const dir = path.join(ROOT, 'release')
  const files = readdirSync(dir)
    .filter((f) => /^蓝笔申论-单文件版-v[\d.]+\.html$/.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const pick = files[files.length - 1]
  if (!pick) throw new Error('release/ 里没有单文件版产物')
  console.log(`· 未指定 URL，自动选用 ${pick}`)
  return 'file:///' + path.join(dir, pick).replace(/\\/g, '/')
}

const base = process.argv[2] || latestSingleUrl()
// 无参数的 http 地址默认落在更新日志页；file:// 直接拼 hash 也一样能用
const url = base.includes('#') ? base : base + '#/changelog'

const profileDir = path.join(process.env.TEMP || '/tmp', `cdp-changelog-${Date.now()}`)
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
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
        logs.push({
          kind: m.params.type,
          text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
        })
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

const cdp = await connect(await targetWs())
await cdp.send('Runtime.enable')
await cdp.send('Log.enable')
await cdp.send('Page.enable')

console.log(`· 打开 ${url}`)
await cdp.send('Page.navigate', { url })
await sleep(3500)

const info = await cdp.send('Runtime.evaluate', {
  expression: `(() => {
    const t = document.body ? document.body.innerText : '(no body)'
    const app = document.querySelector('#app')
    return {
      title: document.title,
      hash: location.hash,
      bodyLen: t.length,
      appChildren: app ? app.children.length : -1,
      appHtmlLen: app ? app.innerHTML.length : -1,
      hasChangelogTitle: t.includes('更新日志'),
      versionNodes: document.querySelectorAll('section h2').length,
      firstVersions: [...document.querySelectorAll('section h2')].slice(0, 5).map((h) => h.innerText),
      itemRows: document.querySelectorAll('section .neu > div').length,
      text: t.slice(0, 500),
    }
  })()`,
  returnByValue: true,
})
console.log('===== 页面状态 =====')
console.log(JSON.stringify(info.result.value, null, 2))

console.log('===== 控制台 =====')
if (!cdp.logs.length) console.log('(无报错)')
for (const l of cdp.logs) console.log(`[${l.kind}] ${l.text.slice(0, 400)}`)

cdp.close()
chrome.kill()
await sleep(400)
try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
