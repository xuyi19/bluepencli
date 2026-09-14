// 验证「客观校验 + 采分点对照」两个新面板真的渲染出来了。
//
//   node .tools/probe-standard-panel.mjs
//
// 为什么不能只看构建通过：
//   面板是 v-if 守卫的，report.hardRules / report.standard 为 null 时**整块消失**，
//   页面照样不报错。只有真的跑一遍批改、读到面板文字，才算验证过。
//
// 前置：mock-llm 跑在 9731，dev server 跑在 5273。

const BASE = 'http://127.0.0.1:5273'
const PORT = 9680 + Math.floor(Math.random() * 200)

const { spawn } = await import('node:child_process')
const { existsSync, writeFileSync } = await import('node:fs')

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))

// 故意写一篇"有硬伤"的答案：字数远不足 + 半角标点 + 整段照抄材料 + 采分点覆盖一半。
// 这样两个面板都必然有内容，不会因为"刚好没问题"而误判成面板没工作。
const ANSWER = `答：一是成立数字乡村建设领导小组，强化统筹协调。二是省财政每年安排专项资金20亿元，对成效突出的县给予每县最高2000万元奖补,同时发展农村电商、统一品牌、统一包装、统一物流。三是开发了乡村微治理小程序。`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const proc = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-std-profile',
  '--window-size=1280,1500',
  'about:blank',
])
proc.on('error', (e) => console.error('Chrome 启动失败：', e.message))

async function wsUrlOf() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* 等待 */
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
  new Promise((resolve) => {
    const myId = ++id
    pending.set(myId, resolve)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.text + ' :: ' + (exceptionDetails.exception?.description || ''))
  return result?.value
}

await send('Page.enable')
await send('Runtime.enable')

// 1) 注入 mock LLM 配置
await send('Page.navigate', { url: `${BASE}/#/practice` })
await sleep(3500)
await evaluate(`
  localStorage.setItem('llm_config', JSON.stringify({
    api_key: 'sk-mock', base_url: 'http://127.0.0.1:9731/v1', model: 'mock-model'
  }));
  localStorage.removeItem('backend_url');
  'ok'
`)

// 2) 打开有采分点标准的题（builtin-q-01 是 public.js 里人工精校的那道）
await send('Page.navigate', { url: `${BASE}/#/practice?questionId=builtin-q-01` })
await send('Page.reload', { ignoreCache: true })
await sleep(5000)

const loaded = await evaluate(`
  (() => {
    const ta = [...document.querySelectorAll('textarea')]
    const title = ta.find(t => (t.placeholder||'').includes('自拟题目'))
    return {
      title: (title?.value || '').slice(0, 40),
      isTargetQ: (title?.value || '').includes('数字乡村'),
      answerBox: !!document.querySelector('textarea.grid-paper'),
    }
  })()
`)
console.log('① 题目载入：', JSON.stringify(loaded))
if (!loaded.isTargetQ) {
  console.error('✗ 没有载入到 q-01（题目正文可能还没到，或路由参数没生效）')
  proc.kill()
  process.exit(1)
}

// 3) 填答案
const filled = await evaluate(`
  (() => {
    const setVal = (el, v) => {
      if (!el) return false
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    const answer = document.querySelector('textarea.grid-paper')
    setVal(answer, ${JSON.stringify(ANSWER)})
    return { ok: !!answer, len: (answer?.value || '').length }
  })()
`)
console.log('② 答案填入：', JSON.stringify(filled))

// 4) 开始批改
await sleep(1200)
const clicked = await evaluate(`
  (() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('答完了'))
    if (!btn) return { clicked: false }
    btn.click()
    return { clicked: true, disabled: btn.disabled }
  })()
`)
console.log('③ 点击开始批改：', JSON.stringify(clicked))

for (let i = 1; i <= 10; i++) {
  await sleep(4000)
  const step = await evaluate(`document.body.innerText.includes('批改结果') ? 'result' : 'grading'`)
  console.log(`   [${i * 4}s] ${step}`)
  if (step === 'result') break
}

// 5) 断言两个面板
const checks = await evaluate(`
(() => {
  const t = document.body.innerText
  const q = (s) => t.includes(s)
  // 取"客观校验"面板那一小段文字
  const seg = (label, nextLabels) => {
    const i = t.indexOf(label)
    if (i < 0) return ''
    let end = t.length
    for (const n of nextLabels) {
      const j = t.indexOf(n, i + label.length)
      if (j >= 0 && j < end) end = j
    }
    return t.slice(i, end).trim()
  }
  return {
    客观校验面板: q('客观校验'),
    采分点对照面板: q('采分点对照'),
    覆盖率字样: (t.match(/覆盖率\\s*\\d+%/) || [''])[0],
    面板原文: seg('客观校验', ['采分点对照']).slice(0, 520),
    对照原文: seg('采分点对照', ['老师批注', '我的作答']).slice(0, 520),
  }
})()
`)

console.log('\n===== 断言 =====')
console.log(JSON.stringify(checks, null, 2))

const shotRes = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
if (shotRes?.data) {
  const out = 'E:/code/bluepencil/.shots/probe-standard-panel.png'
  writeFileSync(out, Buffer.from(shotRes.data, 'base64'))
  console.log('整页截图：' + out)
}

const pass =
  checks.客观校验面板 &&
  checks.采分点对照面板 &&
  /覆盖率\s*\d+%/.test(checks.覆盖率字样 || '') &&
  checks.面板原文.includes('字数') &&
  checks.对照原文.includes('命中')
console.log(pass ? '\n✓ 两个面板均正常渲染' : '\n✗ 面板缺失或内容异常')

proc.kill()
process.exit(pass ? 0 : 1)
