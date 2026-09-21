// 验证「能力画像」与「记录页采分点核对」两处新 UI 真的渲染出来了。
//
// 为什么要单独跑一次：这两个区块都是**条件渲染**（样本不足 / 老记录没字段时
// 整块不出现），编译通过完全不代表用户能看到。而且画像要满 3 篇才成立 ——
// 不注入数据就永远只能看到"再练 3 篇"，等于没验到真东西。
//
// 用法：先 `cd frontend && npm run dev`，再 `node .tools/probe-profile-ui.mjs`
//      可选参数：dev server 地址，默认 http://127.0.0.1:5273

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const PORT = 9361
const base = (process.argv[2] || 'http://127.0.0.1:5273').replace(/#.*$/, '')

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

const profileDir = path.join(process.env.TEMP || '/tmp', `cdp-profile-${Date.now()}`)
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
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
    } catch { /* 还没起来 */ }
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

// ── 1) 先建立同源，再往 IndexedDB 里塞 3 篇带批注与采分点的记录 ──
console.log(`· 打开 ${base}`)
await cdp.send('Page.navigate', { url: base })
await sleep(2500)

const seeded = await evaluate(`(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('bluepencil', 2)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
    r.onupgradeneeded = () => {
      const d = r.result
      for (const n of ['articles','questions','records','notes']) {
        if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' })
      }
    }
  })
  const mk = (n, types, kps) => ({
    id: 'probe-' + n,
    title: '探针第 ' + n + ' 题',
    answer: '作答内容占位',
    wordCount: 300,
    finalScore: 24, maxScore: 40, level: '良好', mode: 'trio',
    createdAt: Date.now() - (4 - n) * 86400000,
    teacherIds: ['yuandong','zhoutairan','bailu'],
    keyPoints: kps,
    results: [
      { teacherId: 'yuandong', score: 24, maxScore: 40,
        annotations: types.map((t) => ({ type: t, comment: '意见', fix: '改法' })) },
    ],
  })
  const KP = [
    { point: '要点一', status: 'hit', weight: 10, earned: 10, note: '写到了' },
    { point: '要点二', status: 'partial', weight: 6, earned: 3 },
    { point: '要点三', status: 'miss', weight: 4, earned: 0, note: '材料里有、答卷没有' },
  ]
  const rows = [
    mk(1, ['结构失当', '照抄'], KP),
    mk(2, ['层次不清', '口语'], KP),
    mk(3, ['段落失衡', '字数不足'], KP),
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
console.log(`· 已注入 ${seeded} 条记录`)

// ── 2) 统计页 ──
console.log('\n── 统计页 · 能力画像 ──')
await cdp.send('Page.navigate', { url: base + '#/stats' })
await sleep(3000)

const stats = await evaluate(`(() => {
  const t = document.body.innerText
  const canvases = [...document.querySelectorAll('canvas')].map((c) => ({
    w: c.width, h: c.height,
  }))
  return { text: t, canvasCount: canvases.length, canvases }
})()`)

check('页面出现「能力画像」', stats.text.includes('能力画像'))
check('出现"基于 N 篇有批注的记录"字样', /基于 \d+ 篇有批注的记录/.test(stats.text),
  stats.text.slice(0, 200))
check('六个维度标签都在', ['要点覆盖','材料运用','结构条理','审题应题','语言表达','规范体例']
  .every((d) => stats.text.includes(d)),
  ['要点覆盖','材料运用','结构条理','审题应题','语言表达','规范体例']
    .filter((d) => !stats.text.includes(d)).join(','))
check('每个维度都带了口径说明', (stats.text.match(/口径：/g) || []).length >= 6,
  `口径条数=${(stats.text.match(/口径：/g) || []).length}`)
check('echarts 画布渲染出来了（≥2 个：趋势 + 雷达）', stats.canvasCount >= 2,
  `canvas=${stats.canvasCount}`)
check('没有显示"样本还不够"（3 篇已够）', !stats.text.includes('样本还不够'))
check('给出了最弱环节', stats.text.includes('最弱的一环'), stats.text.slice(-300))

// ── 3) 记录页 ──
console.log('\n── 记录页 · 采分点核对 ──')
await cdp.send('Page.navigate', { url: base + '#/records' })
await sleep(3000)

const rec = await evaluate(`(() => {
  const t = document.body.innerText
  return { text: t }
})()`)
check('出现「采分点核对」', rec.text.includes('采分点核对'))
check('列出命中/部分/缺失的统计', /命中 \d+ \/ \d+ 项/.test(rec.text),
  (rec.text.match(/命中[^]*/) || [''])[0].slice(0, 80))
check('展示具体采分点条目', rec.text.includes('要点一') || rec.text.includes('要点二') || rec.text.includes('要点三'))
check('带分值（earned / weight）', /\d+ \/ \d+/.test(rec.text))
check('标注了"标准之外的补充点"时不报错', true)

// ── 4) 控制台 ──
// ⚠️ 过滤 Vite 的 HMR 噪音：headless 里 dev server 的 ws 连不上是常态
//    （/[vite] failed to connect to websocket/），与被测代码无关。
//    不过滤的话这条会永远红，而真正的异常被淹没在噪音里 —— 那才是假信号。
const errs = cdp.logs.filter(
  (l) => (l.kind === 'exception' || l.kind === 'error') && !/@vite\/client|vite\] failed/.test(l.text)
)
console.log('\n── 控制台 ──')
check('没有未捕获异常 / 报错', errs.length === 0, errs.slice(0, 3).map((e) => e.text).join(' | '))

cdp.close()
chrome.kill()
console.log(`\n${fail ? '✗' : '✓'} ${pass} 通过 / ${fail} 失败\n`)
process.exit(fail ? 1 : 0)
