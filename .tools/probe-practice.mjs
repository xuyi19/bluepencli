// 练习页专项探针：验证「题目和材料不再为空」与「从题库带入时字段不丢」。
//
// 为什么必须写成断言而不是靠截图：
//   这次修的 bug 是 practiceWith 只传了 title + material，
//   requirement / maxScore / wordLimit 全丢——截图上完全看不出来（字段是空的，
//   和"用户还没填"长得一模一样）。只有断言值相等才能证明它真的带过来了。

const BASE = process.argv[2] || 'http://127.0.0.1:5273'
const PORT = 9500 + Math.floor(Math.random() * 400)

const { spawn } = await import('node:child_process')
const { existsSync } = await import('node:fs')

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-probe-practice-' + Date.now(),
  '--window-size=1280,1000', 'about:blank',
])

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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
}
const send = (method, params = {}) =>
  new Promise((r) => { const myId = ++id; pending.set(myId, r); ws.send(JSON.stringify({ id: myId, method, params })) })
const evaluate = async (expression) => {
  const { result } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result?.subtype === 'error') throw new Error(result.description)
  return result?.value
}

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`)
}

await send('Page.enable')

// ---------- 1. 直接进练习页：应当自动载入今日一练 ----------
await send('Page.navigate', { url: `${BASE}/#/practice` })
await sleep(4500)
const auto = await evaluate(`
(async () => {
  const nums = [...document.querySelectorAll('input[type=number]')]
  const tas = [...document.querySelectorAll('textarea')]
  const title = tas.find(t => (t.placeholder||'').includes('自拟题目'))
  const req = tas.find(t => (t.placeholder||'').includes('观点明确'))
  return {
    title: title?.value || '',
    req: req?.value || '',
    maxScore: nums[0]?.value || '',
    wordLimit: nums[1]?.value || '',
    materialChars: (document.body.innerText.match(/给定资料\\s*(\\d+)\\s*字/) || [])[1] || '',
    hasGrid: !!document.querySelector('textarea.grid-paper'),
    dailyBadge: document.body.innerText.includes('今日一练'),
  }
})()
`)
check('进页面自动载入题目（题干非空）', auto.title.length > 8, `题干 ${auto.title.length} 字`)
check('自动载入作答要求', auto.req.length > 4, `要求：${auto.req}`)
check('自动载入分值', Number(auto.maxScore) > 0, `满分 ${auto.maxScore}`)
check('自动载入字数限制', Number(auto.wordLimit) > 0, `字数 ${auto.wordLimit}`)
check('自动载入材料', Number(auto.materialChars) > 200, `材料 ${auto.materialChars} 字`)
check('今日一练横幅存在', auto.dailyBadge)
check('方格作答纸存在', auto.hasGrid)

// ---------- 2. 从题库页点「做这道题」，五个字段都要跟着走 ----------
await send('Page.navigate', { url: `${BASE}/#/questions` })
await sleep(3500)

// 挑一道非今日一练的题（列表第 7 张卡 = q-07 提出对策，25 分 / 400 字）
const picked = await evaluate(`
(() => {
  const cards = [...document.querySelectorAll('div.rounded-2xl')].filter(d => d.querySelector('button'))
  const card = cards.find(c => (c.innerText||'').includes('进一步优化中小企业营商环境'))
  if (!card) return null
  const req = (card.innerText.match(/要求：([^\\n]+)/) || [])[1] || ''
  card.querySelector('button').click()
  return { req }
})()
`)
check('题库页找到目标题并点击「做这道题」', !!picked, picked ? `要求：${picked.req}` : '')
await sleep(3000)

const after = await evaluate(`
(() => {
  const nums = [...document.querySelectorAll('input[type=number]')]
  const tas = [...document.querySelectorAll('textarea')]
  const title = tas.find(t => (t.placeholder||'').includes('自拟题目'))
  const req = tas.find(t => (t.placeholder||'').includes('观点明确'))
  return {
    url: location.href,
    title: title?.value || '',
    req: req?.value || '',
    maxScore: nums[0]?.value || '',
    wordLimit: nums[1]?.value || '',
  }
})()
`)
check('跳到练习页并带上 questionId', after.url.includes('questionId='), after.url.split('#')[1] || '')
check('题干带过来了', after.title.includes('营商环境'), after.title.slice(0, 30))
check('作答要求带过来了（原来会丢）', after.req.includes('具体可行'), `要求：${after.req}`)
check('满分带过来了（原来会丢）', after.maxScore === '25', `满分 ${after.maxScore}`)
check('字数限制带过来了（原来会丢）', after.wordLimit === '400', `字数 ${after.wordLimit}`)

// ---------- 3. 换一题：题目应当变化 ----------
const before = after.title
await evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim() === '换一题')
  b?.click()
})()
`)
await sleep(1200)
const shuffled = await evaluate(`
(() => {
  const tas = [...document.querySelectorAll('textarea')]
  const t = tas.find(x => (x.placeholder||'').includes('自拟题目'))
  return { title: t?.value || '', nums: [...document.querySelectorAll('input[type=number]')].map(n=>n.value) }
})()
`)
check('换一题换掉了题目', shuffled.title !== before, `${before.slice(0, 14)}… → ${shuffled.title.slice(0, 14)}…`)
check('换题后分值同步更新', shuffled.nums[0] !== after.maxScore || shuffled.nums[1] !== after.wordLimit,
  `满分 ${shuffled.nums[0]} / 字数 ${shuffled.nums[1] || '不限'}`)

// ---------- 4. 选题面板：从题库单选一道 ----------
await evaluate(`
(() => {
  const b = [...document.querySelectorAll('button')].find(x => (x.innerText||'').trim() === '从题库选题')
  b?.click()
})()
`)
await sleep(900)
const pickerCount = await evaluate(`
(() => {
  const btns = [...document.querySelectorAll('button')].filter(b => (b.innerText||'').includes('（仿真）') || /国家公务员考试|多省联考|事业单位/.test(b.innerText||''))
  return btns.length
})()
`)
check('选题面板列出题库', pickerCount >= 15, `列出 ${pickerCount} 条`)

await evaluate(`
(() => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText||'').includes('银发经济') || (b.innerText||'').includes('守正创新'))
  btn?.click()
})()
`)
await sleep(1200)
const picked2 = await evaluate(`
(() => {
  const tas = [...document.querySelectorAll('textarea')]
  const t = tas.find(x => (x.placeholder||'').includes('自拟题目'))
  const gp = document.querySelector('textarea.grid-paper')
  return { title: t?.value || '', pickerClosed: !document.body.innerText.includes('搜索题目 / 来源 / 主题'), gridEmpty: (gp?.value||'').length === 0 }
})()
`)
check('选题后面板自动收起', picked2.pickerClosed)
check('选题后面板选中的题进入表单', picked2.title.length > 8, picked2.title.slice(0, 24))
check('换题会清空上一题的作答（避免串题）', picked2.gridEmpty)

console.log(failures ? `\n${failures} 项不通过` : '\n全部通过')
ws.close()
proc.kill()
process.exit(failures ? 1 : 0)
