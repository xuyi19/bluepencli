// 真实 API 端到端：用**真 Key**跑一遍「答题 → 批改 → 结果」，
// 验证 PLAN 2.1 的阻塞项（至今所有验证都是假 LLM），并取回真实耗时与成本。
//
// 用法（Key 走环境变量，绝不写进代码）：
//   set BP_REAL_KEY=xxx
//   node .tools/e2e-real.mjs [--teacher 1]
//
// ⚠️ 会真花钱。默认 1 位老师（最省），加 --teacher 3 才走圆桌。
//
// 依赖 mock-llm.mjs（假 LLM）。用 CDP 做真实交互与真实等待，
// 这样验证的是真的链路，而不是「页面没白屏」。
//
// 用法：node e2e-grade.mjs [screenshotPath]

const BASE = 'http://127.0.0.1:5273'
// 端口每次不同：Windows 上 proc.kill() 杀不掉 Chrome 进程树，
// 残留实例会占着固定端口，导致新进程连到旧实例、拍到/操作到上一页。
const PORT = 9600 + Math.floor(Math.random() * 300)
const REAL_BASE = process.env.BP_REAL_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'
const REAL_KEY = process.env.BP_REAL_KEY || ''
const REAL_MODEL = process.env.BP_REAL_MODEL || 'glm-4-flash'
if (!REAL_KEY) {
  console.error('✗ 需要真 Key：set BP_REAL_KEY=... 后重跑（不要把 Key 写进脚本）')
  process.exit(1)
}
const TEACHER_N = process.argv.includes('--teacher') ? Number(process.argv[process.argv.indexOf('--teacher') + 1]) : 1

const { spawn } = await import('node:child_process')
const { existsSync, writeFileSync } = await import('node:fs')

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))

const ANSWER = `老吾老，以及人之老。截至2025年末，我国60周岁及以上老年人口已达32338万人，占总人口的23%。庞大的银发群体既是民生保障的重点，也是消费市场新的增长极。然而现实中，很多人把养老产业简单等同于养老院和护理床位，忽视了适老化产品与银发消费的巨大空间。发展银发经济，需以需求为牵引、以供给为支撑、以政策为保障。

把握需求之变，把刚需化为蓝海之源。上海的报告显示，新退休群体正成为消费主力，文娱旅游、养生保健需求大幅增长。从存钱养老到乐享晚年，银发消费正由生存型向享受型跃升。

补齐供给之短，以蓝海承接刚需期待。我国适老化产品总量虽达21.6万种，但与庞大人口基数相比仍显不足。一方面企业要加快研发，另一方面政府要加大补贴，让好产品真正走进家庭。松下的淋浴椅在配色上为阿尔茨海默病患者反复斟酌，靠的正是对需求的精准洞察。

强化政策之引，促刚需与蓝海双向奔赴。从扩大消费规划明确扩大银发产品供给，到适老化改造纳入补贴范围带动销售721万件，政策的每一次落子都在培育沃土。

因此，我们要高度重视养老问题，让亿万老年人共享发展成果。`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const proc = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-e2e-profile',
  '--window-size=1280,1400',
  'about:blank',
])

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

// ── 1) 打开练习页，注入真配置，重载生效 ──
await send('Page.navigate', { url: `${BASE}/#/practice` })
await sleep(3500)
await evaluate(`
  localStorage.setItem('llm_config', JSON.stringify({
    api_key: ${JSON.stringify(REAL_KEY)},
    base_url: ${JSON.stringify(REAL_BASE)},
    model: ${JSON.stringify(REAL_MODEL)}
  }));
  localStorage.removeItem('backend_url');   // 后端网关开着时走它（记账），关了就浏览器直连
  'ok'
`)
await send('Page.reload', { ignoreCache: true })
await sleep(5000)
console.log(`① 真配置已注入：${REAL_BASE} / ${REAL_MODEL} ｜ 老师 ${TEACHER_N} 位`)

// ── 2) 选老师：1 位点「东哥」，3 位以上点「三师圆桌」 ──
const presetLabel = TEACHER_N <= 1 ? '东哥' : '三师圆桌'
const picked = await evaluate(`
(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(presetLabel)})
  if (!btn) return { ok: false, labels: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 14) }
  btn.click(); return { ok: true }
})()
`)
console.log('② 选老师', JSON.stringify(picked))
await sleep(800)

// ── 3) 填表（Vue v-model 需要原生 setter + input 事件）──
const filled = await evaluate(`
(() => {
  const setVal = (el, v) => {
    if (!el) return false
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }
  const ta = [...document.querySelectorAll('textarea')]
  const title = ta.find(t => (t.placeholder||'').includes('自拟题目'))
  const answer = document.querySelector('textarea.grid-paper') || ta.find(t => (t.placeholder||'').includes('作答'))
  const req = ta.find(t => (t.placeholder||'').includes('观点明确'))
  setVal(title, '结合给定资料，围绕「养老刚需也是产业蓝海」自拟题目，写一篇文章')
  setVal(req, '观点明确，结构完整，语言流畅，1000 字左右')
  setVal(answer, ${JSON.stringify(ANSWER)})
  return { title: !!title, req: !!req, answer: !!answer, answerLen: (answer?.value||'').length }
})()
`)
console.log('③ 表单填写', JSON.stringify(filled))

// ── 4) 提交批改 ──
await sleep(1200)
const clicked = await evaluate(`
(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('答完了') || b.textContent.includes('交卷'))
  if (!btn) return { clicked: false, buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 12) }
  const disabled = btn.disabled
  if (disabled) return { clicked: false, disabled: true, text: btn.textContent.trim() }
  btn.click(); return { clicked: true, text: btn.textContent.trim() }
})()
`)
console.log('④ 提交', JSON.stringify(clicked))
if (!clicked.clicked) {
  console.log('   ✗ 没能提交（按钮禁用或没找到）—— 检查 Key/老师/作答字数')
  ws.close(); proc.kill(); process.exit(1)
}

// ── 5) 真实等待（真 API 比 mock 慢得多）──
const t0 = Date.now()
let reached = ''
for (let i = 1; i <= 30; i++) {
  await sleep(5000)
  const stage = await evaluate(`(() => { const t = document.body.innerText; return t.includes('批改中') ? 'grading' : t.includes('批改结果') ? 'result' : 'other' })()`)
  console.log(`   [${i * 5}s] ${stage}`)
  if (stage === 'result') { reached = 'result'; break }
  if (stage === 'other' && i > 3) { reached = 'unknown'; break }
}
const cost = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`⑤ 等待 ${cost}s → ${reached}`)

// ── 6) 读结果 ──
const text = await evaluate('document.body.innerText')
console.log('\n===== 结果页（前 2200 字）=====')
console.log(text.slice(0, 2200))

// ── 7) 后端记账（若开着）：拿真实 token/成本 ──
try {
  const stats = await (await fetch('http://127.0.0.1:8100/api/v1/stats')).json()
  const llm = await (await fetch('http://127.0.0.1:8100/api/v1/llm-calls?limit=20')).json().catch(() => null)
  console.log('\n===== 后端记账 =====')
  console.log('stats:', JSON.stringify(stats).slice(0, 400))
} catch (e) {
  console.log('\n（后端未开，跳过记账；本次只验证了批改链路）')
}

ws.close()
proc.kill()
