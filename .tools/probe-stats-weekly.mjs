// 验证 M7 学习周报区块真的渲染出来，且**每个数字都能在盘上找到出处**。
//
// 为什么单独探：周报是「条件渲染 + 本地规则派生」——编译通过不代表用户能看到，
// 更不代表展示的数字与 weekly.js 的派生口径一致。这里用真浏览器 + 注入已知数据，
// 断言「用户看得见的结果」（页面上出现的文字），不断言内部变量。
//
// 用法：cd frontend && npx vite --port 5282 --strictPort
//      node .tools/probe-stats-weekly.mjs [base]   （默认 http://127.0.0.1:5282）

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const base = (process.argv[2] || 'http://127.0.0.1:5282').replace(/#.*$/, '')

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

const profileDir = path.join(process.env.TEMP || '/tmp', `cdp-weekly-${Date.now()}`)
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--remote-debugging-port=9371', `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targetWs() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9371/json/list')).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch { /* 还没起来 */ }
    await sleep(400)
  }
  throw new Error('CDP 端口没起来')
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let id = 0
    ws.onopen = () => resolve({
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
      }
    }
  })
}

const cdp = await connect(await targetWs())
await cdp.send('Runtime.enable')
await cdp.send('Page.enable')

async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${extra ? '  → ' + extra : ''}`)
  }
}

// ── 场景一：本周 3 篇（均值 65%）+ 上周 3 篇（45%）+ 高频批注 ──
console.log(`· 打开 ${base}`)
await cdp.send('Page.navigate', { url: base })
await sleep(2500)

const seeded = await evaluate(`(async () => {
  const db = await new Promise((res, rej) => {
    // ⚠️ 版本必须与 store/db.js 的 DB_VERSION=3 一致：页面先以 3 建库后，
    // 探针再 open(2) 会 VersionError（上轮 Uncaught (in promise) 的根因）。
    // onupgradeneeded 也要建全六个 store——探针先建库时少了的话，
    // 页面同版本 open 不再触发 upgrade，缺的 store 会直接报错。
    const r = indexedDB.open('bluepencil', 3)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
    r.onupgradeneeded = () => {
      const d = r.result
      for (const n of ['articles','questions','records','notes','mistakes','imports']) {
        if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' })
      }
    }
  })
  await new Promise((res, rej) => {
    const tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').clear()
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
  const DAY = 86400000
  const now = new Date()
  const mon = new Date(now)
  mon.setHours(0, 0, 0, 0)
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7))
  const MON = mon.getTime()
  const mk = (id, dayOffset, score, max, types) => ({
    id,
    title: '周报探针 ' + id,
    answer: '作答占位',
    wordCount: 300,
    finalScore: score,
    maxScore: max,
    questionType: '归纳概括',
    mode: 'trio',
    teacherIds: ['yuandong'],
    createdAt: MON + dayOffset * DAY + 3600000,
    results: [{
      teacherId: 'yuandong',
      score, maxScore: max,
      annotations: types.map((type) => ({ type, comment: '意见', fix: '改法' })),
    }],
  })
  const rows = [
    // 本周：(50+70+75)/3 = 65%；wp-1/wp-2 各一条 point-missing → 恰好 2 次（≥MIN_ERROR_COUNT 高频线）
    mk('wp-1', 0, 50, 100, ['point-missing']),
    mk('wp-2', 1, 70, 100, ['point-missing']),
    mk('wp-3', 2, 75, 100, []),
    // 上周：(40+45+50)/3 = 45%
    mk('wp-4', -3, 40, 100, []),
    mk('wp-5', -4, 45, 100, []),
    mk('wp-6', -5, 50, 100, []),
  ]
  await new Promise((res, rej) => {
    const tx = db.transaction('records', 'readwrite')
    const st = tx.objectStore('records')
    rows.forEach((r) => st.put(r))
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
  return rows.length
})()`)
console.log(`· 已注入 ${seeded} 条记录（本周 3 + 上周 3）`)

await cdp.send('Page.navigate', { url: base + '#/stats' })
await sleep(3000)

const s1 = await evaluate(`(() => {
  const el = [...document.querySelectorAll('section, div')].find((n) =>
    n.className && typeof n.className === 'string' && n.className.includes('neu') &&
    n.innerText && n.innerText.includes('本周周报'))
  return { text: el ? el.innerText : (document.body.innerText || '') }
})()`)
const t1 = s1.text || ''

check('「本周周报」区块出现', t1.includes('本周周报'))
check('周区间 label 是「M月D日 – M月D日」形式', /\d+月\d+日\s*[–-]\s*\d+月\d+日/.test(t1),
  (t1.match(/\d+月\d+日[^\n]*/) || [''])[0])
check('本周篇数 3 篇如实呈现', /本周练习[\s\S]{0,40}?3\s*篇/.test(t1), t1.slice(0, 200))
check('本周平均得分率 65%', /65%/.test(t1))
check('对比给出 +20（本周 65% − 上周 45%）', /\+20/.test(t1))
check('对比带依据（本周 3 篇 vs 上周 3 篇）', /本周 3 篇 vs 上周 3 篇/.test(t1))
check('advice 明说高出上周', /高出上周/.test(t1))
check('高频错误「要点遗漏」进下周重点', /要点遗漏/.test(t1))
check('高频带次数（2 次）', /2\s*次/.test(t1))
check('高频带可照做的自查（逐段圈）', /逐段圈/.test(t1))
check('数据足时不出现「样本」托词', !/样本太少|样本不够/.test(t1))

// ── 场景二：清空后只留上周 2 篇 → 本周空周，诚实空态 ──
console.log('\n── 场景二：空周 ──')
const seeded2 = await evaluate(`(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('bluepencil', 3)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const DAY = 86400000
  const now = new Date()
  const mon = new Date(now)
  mon.setHours(0, 0, 0, 0)
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7))
  const MON = mon.getTime()
  const rows = [
    { id: 'wp-e1', title: '空周探针 1', finalScore: 40, maxScore: 100, createdAt: MON - 3 * DAY + 3600000, results: [] },
    { id: 'wp-e2', title: '空周探针 2', finalScore: 50, maxScore: 100, createdAt: MON - 4 * DAY + 3600000, results: [] },
  ]
  await new Promise((res, rej) => {
    const tx = db.transaction('records', 'readwrite')
    const st = tx.objectStore('records')
    st.clear()
    rows.forEach((r) => st.put(r))
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
  })
  return rows.length
})()`)
console.log(`· 重置为空周（仅上周 ${seeded2} 篇）`)

// ⚠️ #/stats → #/stats 同 hash 导航不触发页面重载，组件不会重读 IndexedDB，
// 断到的还是场景一的旧渲染。先跳空白页强制整页重载再回来。
await cdp.send('Page.navigate', { url: 'about:blank' })
await sleep(800)
await cdp.send('Page.navigate', { url: base + '#/stats' })
await sleep(3000)

const s2 = await evaluate(`(() => {
  const el = [...document.querySelectorAll('section, div')].find((n) =>
    n.className && typeof n.className === 'string' && n.className.includes('neu') &&
    n.innerText && n.innerText.includes('本周周报'))
  return { text: el ? el.innerText : (document.body.innerText || '') }
})()`)
const t2 = s2.text || ''

check('空周明说没动笔（不编数据）', /还没动笔|没动笔/.test(t2), t2.slice(0, 160))
check('上周数据仍如实呈现（2 篇）', /上周/.test(t2) && !/还没动笔[\s\S]{0,80}上周没练/.test(t2), '')

console.log(`\n${pass + fail} 项：${pass} 绿 ${fail ? fail + ' 红' : '0 红'}`)
chrome.kill()
process.exit(fail ? 1 : 0)
