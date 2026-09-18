// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 错题本页 +「再练一题」的端到端探针。
//
// 为什么要注入记录而不是手点：走一遍 UI 批改要真 Key、要几分钟，
// 而注入能精确构造出三个分支，把"没依据时闭嘴"这条最容易做错的路径也覆盖到。
//
// ⚠️ 注入的记录**必须带 `questionType`** —— 缺了它推荐逻辑一条也进不来
//    （那正是老记录的情形，专门有一个场景去验它）。
// ⚠️ 注入的记录**必须带 `results`** —— 缺了它 `ensureCanonical` 会当成旧形态重造，
//    批注全丢，错题本会是空的。
//
// 用法：
//   node .tools/probe-weakness.mjs http://127.0.0.1:5273
//   node .tools/probe-weakness.mjs http://127.0.0.1:8100

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = (process.argv[2] || 'http://127.0.0.1:5273').replace(/#.*$/, '')
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))
if (!CHROME) {
  console.error('找不到 Chrome / Edge')
  process.exit(1)
}

const PORT = 9333
const profileDir = mkdtempSync(join(tmpdir(), 'bp-weak-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targetWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch { /* 还没起来 */ }
    await sleep(250)
  }
  throw new Error('连不上浏览器调试端口')
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? rej(new Error(m.error.message)) : res(m.result)
    }
  }
  return {
    send: (method, params = {}) => new Promise((res, rej) => {
      const mid = ++id
      pending.set(mid, { res, rej })
      ws.send(JSON.stringify({ id: mid, method, params }))
    }),
    close: () => ws.close(),
  }
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `   —— ${detail}` : ''}`)
}

/** 注入构造记录：全部走 IndexedDB，与页面自己写的是同一个库 */
const SEED = (records) => `(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('bluepencil', undefined)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const tx = db.transaction('records', 'readwrite')
  const store = tx.objectStore('records')
  for (const rec of ${JSON.stringify(records)}) store.put(rec)
  await new Promise((res) => { tx.oncomplete = res })
  db.close()
  return true
})()`

const ann = (type, quote) => ({ quote, type, comment: '说明', fix: '改法' })
const ded = (point, score) => ({ point, score, reason: '为什么扣', fix: '怎么改' })
const rec = (id, questionType, issues) => ({
  id,
  createdAt: Date.now() - Math.floor(Math.random() * 1e6),
  title: `${questionType}练习`,
  questionType,
  requirement: '全面准确有条理',
  material: '材料',
  answer: '作答内容',
  wordLimit: 250,
  wordCount: 200,
  maxScore: 20,
  mode: 'solo',
  teacherIds: ['yuandong'],
  teachers: [{ id: 'yuandong', name: '袁东' }],
  finalScore: 12,
  results: [{
    teacherId: 'yuandong',
    score: 12,
    maxScore: 20,
    annotations: issues.map((t, i) => ann(t, `第 ${i + 1} 处原文`)),
    deductions: issues.map((t) => ded(t, 1)),
    advice: '建议',
  }],
  elapsed: 1000,
})

const READ = `(() => {
  const t = (document.body ? document.body.innerText : '')
  return {
    hash: location.hash,
    hasCard: t.includes('再练一题'),
    typed: t.includes('同题型对症'),
    spread: t.includes('跨题型通病'),
    text: t,
  }
})()`

const cdp = await connect(await targetWs())
await cdp.send('Runtime.enable')
await cdp.send('Page.enable')
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

let failed = 0
try {
  // ── 场景 A：两个题型，「要点遗漏」只出现在归纳概括上 → 定向推荐 ──
  console.log('\n===== 场景 A：问题集中在单一题型 → 定向推荐 =====')
  await cdp.send('Page.navigate', { url: `${BASE}/#/weakness` })
  await sleep(1500)
  await cdp.send('Runtime.evaluate', {
    expression: SEED([
      rec('w-a1', '归纳概括', ['要点遗漏', '结构不清']),
      rec('w-a2', '归纳概括', ['漏点']),
      rec('w-a3', '大作文', ['整句照抄']),
    ]),
    awaitPromise: true, returnByValue: true,
  })
  await cdp.send('Page.reload')
  await sleep(2200)
  let r = (await cdp.send('Runtime.evaluate', { expression: READ, returnByValue: true })).result.value
  check('推荐卡出现了', r.hasCard, r.hash)
  check('判为「同题型对症」而不是通病', r.typed === true, `typed=${r.typed} spread=${r.spread}`)
  check('话术点名了问题与题型',
    r.text.includes('要点遗漏') && r.text.includes('归纳概括'), '')
  check('候选卡里给出了具体题目（有分值和「练这道」）',
    r.text.includes('练这道') && r.text.includes('分'), '')

  // ── 场景 B：同一问题跨三个题型 → 泛化推荐 ──
  console.log('\n===== 场景 B：问题跨题型 → 泛化推荐 =====')
  await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open('bluepencil', undefined); r.onsuccess = () => res(r.result) })
      const tx = db.transaction('records', 'readwrite')
      tx.objectStore('records').clear()
      await new Promise((res) => { tx.oncomplete = res })
      const tx2 = db.transaction('records', 'readwrite')
      const s = tx2.objectStore('records')
      s.put(${JSON.stringify(rec('w-b1', '归纳概括', ['整句照抄']))})
      s.put(${JSON.stringify(rec('w-b2', '提出对策', ['整句照抄']))})
      s.put(${JSON.stringify(rec('w-b3', '大作文', ['整句照抄']))})
      await new Promise((res) => { tx2.oncomplete = res })
      db.close(); return true
    })()`,
    awaitPromise: true, returnByValue: true,
  })
  await cdp.send('Page.reload')
  await sleep(2200)
  r = (await cdp.send('Runtime.evaluate', { expression: READ, returnByValue: true })).result.value
  check('判为「跨题型通病」', r.spread === true, `typed=${r.typed} spread=${r.spread}`)
  check('话术说明了不是某个题型的问题', r.text.includes('不是某个题型的问题'), '')

  // ── 场景 C：只有旧记录（无题型字段）→ 必须不给推荐 ──
  console.log('\n===== 场景 C：只有旧记录（缺题型）→ 不给推荐 =====')
  await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open('bluepencil', undefined); r.onsuccess = () => res(r.result) })
      const tx = db.transaction('records', 'readwrite')
      tx.objectStore('records').clear()
      await new Promise((res) => { tx.oncomplete = res })
      const old = ${JSON.stringify(rec('w-c1', '', ['要点遗漏']))}
      old.id = 'w-c1'; old.questionType = ''
      const tx2 = db.transaction('records', 'readwrite')
      tx2.objectStore('records').put(old)
      await new Promise((res) => { tx2.oncomplete = res })
      db.close(); return true
    })()`,
    awaitPromise: true, returnByValue: true,
  })
  await cdp.send('Page.reload')
  await sleep(2200)
  r = (await cdp.send('Runtime.evaluate', { expression: READ, returnByValue: true })).result.value
  check('推荐卡不出现（没依据时不硬推）', r.hasCard === false, `hasCard=${r.hasCard}`)
  // 这里正是缺口的价值所在：老记录**能进错题本**（批注都在，按类型照样归类），
  // 但**进不了推荐** —— 因为定位到"哪个题型上栽的"必须有题型字段，而它没有。
  //
  // ⚠️ 别断言"1 份记录"：`listAllRecords` 是**本地 IndexedDB 与后端 docs/practice/
  //    合并**的，后端在跑时页面看到的份数比注入的多 —— 钉死数字会得到一个
  //    "dev 通过、正式产物失败"的假失败（后端在 / 不在，结果就不一样）。
  //    这里要验的是「注入的这份被算进去了」，所以只看它有没有被归出问题类。
  check('老记录照常进错题本（记录被算进去了）',
    r.text.includes('错题本') && /[1-9]\d*\s*份记录/.test(r.text),
    r.text.slice(Math.max(0, r.text.indexOf('错题本')), 400).replace(/\n+/g, ' '))

  // ── 场景 D：点「练这道」能跳到练习页并把题带过去 ──
  console.log('\n===== 场景 D：点「练这道」跳转 =====')
  await cdp.send('Runtime.evaluate', {
    expression: `(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open('bluepencil', undefined); r.onsuccess = () => res(r.result) })
      const tx = db.transaction('records', 'readwrite')
      tx.objectStore('records').clear()
      await new Promise((res) => { tx.oncomplete = res })
      const tx2 = db.transaction('records', 'readwrite')
      const s = tx2.objectStore('records')
      s.put(${JSON.stringify(rec('w-d1', '归纳概括', ['要点遗漏']))})
      s.put(${JSON.stringify(rec('w-d2', '归纳概括', ['漏点']))})
      await new Promise((res) => { tx2.oncomplete = res })
      db.close(); return true
    })()`,
    awaitPromise: true, returnByValue: true,
  })
  await cdp.send('Page.reload')
  await sleep(2200)
  // 真鼠标事件走坐标，不用 element.click()（那会绕过遮挡）
  const hit = (await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '练这道')
      if (!btn) return null
      const r = btn.getBoundingClientRect()
      if (document.body.innerText.includes('再练一题') === false) return null
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }
    })()`,
    returnByValue: true,
  })).result.value
  check('找到「练这道」按钮', !!hit, hit ? `${hit.w}×${hit.h}` : '没找到')
  if (hit) {
    check('按钮尺寸够点（≥40×32）', hit.w >= 40 && hit.h >= 32, `${hit.w}×${hit.h}`)
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: hit.x, y: hit.y, button: 'left', clickCount: 1 })
    }
    // 真题的正文是懒加载的（resolveQuestion 要去取那一卷的 chunk），
    // 等太短会误判成「题目没带过来」—— 这正是假失败最爱的样子。
    await sleep(4500)
    // ⚠️ 取景窗口要够长：整页 innerText 是 7000+ 字，导航栏就占掉好几百。
    //    截 1200 字的话，断言里那些"像是能命中"的宽泛词（如「给定资料」）
    //    会在别处侥幸命中 —— 于是测试是绿的，题干其实压根没渲染。
    //    这条曾经就是假通过，后来才发现。**断言要盯题干里才有的专有名词。**
    const after = (await cdp.send('Runtime.evaluate', {
      expression: `({ hash: location.hash, len: document.body.innerText.length, text: document.body.innerText.slice(0, 9000) })`,
      returnByValue: true,
    })).result.value
    check('跳到了练习页', after.hash.startsWith('#/practice'), after.hash)
    check('题干渲染出来了（未在应用内留下"题干"而是首页兜底）',
      after.text.includes('信息分类总结') === false && after.text.includes('问法') === false,
      `正文长度 ${after.len}`)
    check('题目正文真的加载完了（含该题专有名词，不是空摘要）',
      after.text.includes('风林村') || after.text.includes('村寨银行') || after.text.includes('给定资料1'),
      after.text.replace(/\n+/g, ' ').slice(300, 420))
  }
} finally {
  cdp.close()
  chrome.kill()
  try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
}

failed = results.filter((x) => !x.ok).length
console.log(`\n${results.length - failed} / ${results.length} 通过`)
if (failed) {
  console.log('\n未通过：')
  for (const f of results.filter((x) => !x.ok)) console.log(`  ✗ ${f.name}`)
  process.exit(1)
}
