// 验证「错题本」列表页：往 IndexedDB 注入几条构造好的批改记录，再看页面有没有
// 按「栽在几份记录里」把**反复出现的同一类问题**聚出来。
//
// 为什么要注入而不是手点：这个页面的价值全在"跨记录聚合"上 ——
// 只有 1 份记录时它必须显示空态，有 2 份同类问题才该冒出"反复栽的坑"。
// 走 UI 手点一遍批改要真 Key、要几分钟，注入 3 条记录能把两种分支都覆盖。
//
// 注入用完整记录形态（带 results），因为 buildReviewCard 是从 results 里
// 读逐句批注与扣分项的；只写个标题的记录不会产生任何可归类的问题。
//
// 用法：node .tools/probe-weakness.mjs [base]     # 默认 http://127.0.0.1:8100
// 退出码非 0 表示页面没按预期聚合。

import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

const PORT = 9353

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

const base = (process.argv[2] || 'http://127.0.0.1:8100').replace(/#.*$/, '')
const now = Date.now()

// 三条记录、两种毛病：
//   「漏点」「要点不全」「采分词缺失」是**同一类**（point-missing），
//   分布在两条记录里 → 应该聚成"栽在 2 份"的反复问题。
//   「结构混乱」只出现一次 → 应该落进"只出现过一次"的折叠区。
const RECORDS = [
  {
    id: 'probe-wk-1', createdAt: now - 30000, title: '探针记录 · 一', mode: 'trio',
    finalScore: 28, maxScore: 40, wordCount: 320, teacherIds: ['yuandong', 'zhoutairan'],
    results: [
      { teacherId: 'yuandong', advice: '', annotations: [
        { quote: '材料里提到的监管缺位', type: '漏点', comment: '漏了监管这一层', fix: '补一句监管缺位' },
      ] },
      { teacherId: 'zhoutairan', advice: '', annotations: [
        { quote: '第二点', type: '要点不全', comment: '第二点没展开' },
      ] },
    ],
  },
  {
    id: 'probe-wk-2', createdAt: now - 20000, title: '探针记录 · 二', mode: 'solo',
    finalScore: 31, maxScore: 40, wordCount: 300, teacherIds: ['bailu'],
    results: [
      { teacherId: 'bailu', advice: '', annotations: [
        { quote: '没有提到监管', type: '采分词缺失', comment: '监管这个采分词没写到' },
      ] },
    ],
  },
  {
    id: 'probe-wk-3', createdAt: now - 10000, title: '探针记录 · 三', mode: 'solo',
    finalScore: 33, maxScore: 40, wordCount: 280, teacherIds: ['kiwi'],
    results: [
      { teacherId: 'kiwi', advice: '', annotations: [
        { quote: '这一段', type: '结构混乱', comment: '条理不顺' },
      ] },
    ],
  },
]

const INJECT = `(async () => {
  const RECORDS = ${JSON.stringify(RECORDS)}
  return await new Promise((resolve) => {
    const req = indexedDB.open('bluepencil', 2)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('records', 'readwrite')
      const st = tx.objectStore('records')
      for (const r of RECORDS) st.put(r)
      tx.oncomplete = () => resolve('injected:' + RECORDS.length)
      tx.onerror = () => resolve('tx-error:' + tx.error)
    }
    req.onerror = () => resolve('open-error:' + req.error)
  })
})()`

const READ_PAGE = `JSON.stringify({
  hash: location.hash,
  hasTitle: document.body.innerText.includes('错题本'),
  text: document.body.innerText.slice(0, 1200),
  repeated: [...document.querySelectorAll('span')].map(s => s.innerText).filter(t => /栽在 \\d+ 份/.test(t)),
  singleOpenLabel: [...document.querySelectorAll('button')].map(b => b.innerText).find(t => t.includes('只出现过一次')) || '',
})`

const profileDir = path.join(process.env.TEMP || '/tmp', `cdp-wk-${Date.now()}`)
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--window-size=1440,900',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
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
      if (m.method === 'Log.entryAdded') logs.push({ kind: `log:${m.params.entry.level}`, text: m.params.entry.text })
    }
  })
}

const cdp = await connect(await targetWs())
await cdp.send('Runtime.enable')
await cdp.send('Log.enable')
await cdp.send('Page.enable')

// 先开一次首页：让应用自己把库和 store 建好，注入时才不会撞上"表不存在"
console.log(`· 打开 ${base} 建立本地库`)
await cdp.send('Page.navigate', { url: base + '#/' })
await sleep(3000)

const injected = (await cdp.send('Runtime.evaluate', {
  expression: INJECT, returnByValue: true, awaitPromise: true,
})).result.value
console.log(`· 注入记录：${injected}`)

console.log('· 打开错题本页')
await cdp.send('Page.navigate', { url: base + '#/weakness' })
await sleep(3000)

const page = JSON.parse((await cdp.send('Runtime.evaluate', {
  expression: READ_PAGE, returnByValue: true,
})).result.value)

console.log('\n===== 页面 =====')
console.log(page.text)

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) failed++
}

console.log('\n===== 断言 =====')
check('打开的是错题本页', page.hasTitle)
check('反复问题识别出来了', page.repeated.length > 0, page.repeated.join(' / '))
check('「漏点」三类写法聚成同一类、记到 2 份',
  page.repeated.some((t) => t.includes('栽在 2 份')), page.repeated.join(' / '))
check('只出现一次的问题收在折叠区', page.singleOpenLabel.includes('只出现过一次'), page.singleOpenLabel)

console.log('\n===== 控制台 =====')
const errs = cdp.logs.filter((l) => l.kind === 'exception' || l.kind.includes('error'))
if (!errs.length) console.log('(无报错)')
for (const l of cdp.logs) console.log(`[${l.kind}] ${l.text.slice(0, 300)}`)

console.log(`\n结论：${failed === 0 ? '错题本聚合正确' : `${failed} 项不通过`}`)

cdp.close()
chrome.kill()
await sleep(400)
try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
process.exit(failed === 0 ? 0 : 1)
