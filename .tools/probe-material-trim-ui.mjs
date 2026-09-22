// 验证「按题裁材料」两处新 UI 真的渲染、真的能切：
//   ① 题库页「材料预览」：展开后只显示本题引用的那几则，带「本题用给定资料N」标签；
//   ② 练习页：材料区有裁剪说明条；「查看整卷材料 ⇄ 只用本题材料」往返切换后内容跟着变；
//   ③ 全程无页面异常（Vite HMR websocket 失败是 headless 常态，过滤）。
//
// 用法：先 `cd frontend && npm run dev`，再 `node .tools/probe-material-trim-ui.mjs`
//      可选参数：dev server 地址，默认 http://127.0.0.1:5273
//
// 为什么不能只靠单测：裁剪条与切换按钮全是**条件渲染**，编译过 ≠ 用户看得到。
// 用真实浏览器点真实按钮 —— 能渲染 ≠ 点得到。

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const PORT = 9377
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

/** 轮询直到表达式为真值；真题正文是动态 import 按需载的，必须等 */
async function pollEval(expression, { timeout = 12000, every = 500 } = {}) {
  const t0 = Date.now()
  for (;;) {
    const v = await evaluate(expression)
    if (v) return v
    if (Date.now() - t0 > timeout) return null
    await sleep(every)
  }
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

// 目标题：2014 副省级第 2 题（题干明确引用「给定资料2」，是裁剪的教科书场景）
const STEM_SNIPPET = '揭示了当前社会心理'

// ⚠️ 定位卡片不能用"从按钮向上爬祖先"：列表容器也包含所有题干文本，
//    会把第一张卡误当目标。反过来 —— 从**题干文本节点**向上爬，
//    第一个同时带「做这道题」按钮的祖先就是目标卡本身。
const FIND_CARD = `(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    if (!node.textContent.includes('${STEM_SNIPPET}')) continue
    let el = node.parentElement
    for (let i = 0; i < 10 && el && el !== document.body; i++) {
      // 卡根 = 同时含「做这道题」按钮与 <details>（材料预览/参考答案）的祖先；
      // 只看按钮会停在卡片标题行（details 在标题行的下方兄弟节点里）。
      const hasBtn = [...el.querySelectorAll('button')].some(b => b.textContent.trim() === '做这道题')
      if (hasBtn && el.querySelector('details')) {
        return el
      }
      el = el.parentElement
    }
  }
  return null
})()`

// ── 题库页 ──
console.log(`· 打开题库页`)
await cdp.send('Page.navigate', { url: base + '/#/questions' })
await pollEval(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '做这道题')`)
await sleep(800)

const found = await evaluate(`(() => {
  const card = ${FIND_CARD}
  if (!card) return { ok: false }
  const sum = [...card.querySelectorAll('summary')].find(s => s.textContent.includes('材料预览'))
  if (sum) sum.click()
  return { ok: true, card: !!sum }
})()`)
check('找到 2014 副省级第 2 题的卡片', found.ok)
check('该卡有「材料预览」折叠并已点开', found.card)

const prevLabel = await pollEval(
  `document.body.innerText.includes('本题用给定资料2') ? true : null`, { timeout: 10000 })
check('预览标签显示「本题用给定资料2」', !!prevLabel)

const prevText = await evaluate(`(() => {
  const det = [...document.querySelectorAll('details')].find(d =>
    d.open && d.querySelector('summary')?.textContent.includes('材料预览'))
  const box = det && det.querySelector('[class*="max-h-72"]')
  return box ? box.innerText : ''
})()`)
const prevLabels = (String(prevText).match(/^材料\d+$/gm) || [])
check('预览正文只含「材料2」一则', prevLabels.join() === '材料2', `实际: ${prevLabels.join(',') || '(空)'}`)
check('预览正文非空', String(prevText).length > 200, `长度 ${String(prevText).length}`)

// ── 练习页 ──
console.log(`· 跳练习页`)
await evaluate(`(() => {
  const card = ${FIND_CARD}
  const btn = card && [...card.querySelectorAll('button')].find(b => b.textContent.trim() === '做这道题')
  if (btn) btn.click()
  return !!btn
})()`)
await pollEval(`location.hash.includes('/practice') ? true : null`)
const bar = await pollEval(`document.body.innerText.includes('本题用给定资料2') ? true : null`, { timeout: 15000 })
check('练习页出现裁剪说明条', !!bar)

const trimmed = await pollEval(`(() => {
  const box = document.querySelector('div[class*="26rem"]')
  if (!box) return null
  const labels = box.innerText.match(/^材料\\d+$/gm) || []
  return labels.length === 1 && labels[0] === '材料2' ? labels : null
})()`)
check('作答区默认只显示「材料2」一则', !!trimmed, `实际: ${JSON.stringify(trimmed)}`)

// 切到整卷（则数不预设：不同卷 4~7 则不等，只要明显多于 1 则即算整卷）
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('查看整卷材料'))
  if (btn) btn.click()
  return !!btn
})()`)
const full = await pollEval(`(() => {
  const box = document.querySelector('div[class*="26rem"]')
  if (!box) return null
  const labels = box.innerText.match(/^材料\\d+$/gm) || []
  return labels.length >= 3 ? labels.length : null
})()`)
check('「查看整卷材料」切回整卷（≥3 则）', !!full, `实际: ${JSON.stringify(full)}`)
const btnFlipped = await evaluate(
  `[...document.querySelectorAll('button')].some(b => b.textContent.includes('只用本题材料'))`)
check('切换按钮文案翻转', !!btnFlipped)

// 切回裁剪
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('只用本题材料'))
  if (btn) btn.click()
  return !!btn
})()`)
const back = await pollEval(`(() => {
  const box = document.querySelector('div[class*="26rem"]')
  if (!box) return null
  const labels = box.innerText.match(/^材料\\d+$/gm) || []
  return labels.length === 1 ? labels : null
})()`)
check('「只用本题材料」切回单则', !!back, `实际: ${JSON.stringify(back)}`)

// ── 页面异常（过滤 Vite HMR/ws 噪音 —— headless 连不上是常态，
//    且它以 Uncaught exception 形式出现，exception 类也要过滤文本）──
const errs = cdp.logs.filter((l) => {
  if (/websocket|hmr|@vite|favicon|Failed to load resource/i.test(l.text)) return false
  return l.kind === 'exception' || l.kind === 'error'
})
check('无页面异常', errs.length === 0, errs.slice(0, 2).map((e) => e.text.slice(0, 120)).join(' | '))

chrome.kill()
console.log(`\n${'═'.repeat(46)}`)
console.log(`结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
