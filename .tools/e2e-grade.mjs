// 端到端跑一遍「答题 → 批改 → 色标批注 → 归档」主链路。
//
// 依赖 mock-llm.mjs（假 LLM）。用 CDP 做真实交互与真实等待，
// 这样验证的是真的链路，而不是「页面没白屏」。
//
// 用法：node e2e-grade.mjs [screenshotPath]

const BASE = 'http://127.0.0.1:5273'
// 端口每次不同：Windows 上 proc.kill() 杀不掉 Chrome 进程树，
// 残留实例会占着固定端口，导致新进程连到旧实例、拍到/操作到上一页。
const PORT = 9600 + Math.floor(Math.random() * 300)
const shot = process.argv[2] || 'E:/code/bluepencil/.shots/e2e-result.png'

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

// 1) 先打开页面，注入 mock LLM 配置，再重载让它生效
await send('Page.navigate', { url: `${BASE}/#/practice` })
await sleep(3500)
await evaluate(`
  localStorage.setItem('llm_config', JSON.stringify({
    api_key: 'sk-mock',
    base_url: 'http://127.0.0.1:9731/v1',
    model: 'mock-model'
  }));
  localStorage.removeItem('backend_url');
  'ok'
`)
// 注意：hash 路由下 navigate 到同一 URL 不会真正重载页（JS 上下文不重建，
// computed 仍持旧值）。必须显式 reload，否则会误判成「配置没生效」。
await send('Page.reload', { ignoreCache: true })
await sleep(4500)

console.log('① 配置已注入，页面已重载')
console.log('   hasKey 检测：', await evaluate(`!!JSON.parse(localStorage.getItem('llm_config')||'{}').api_key`))

// 2) 填表（Vue 的 v-model 需要原生 setter + input 事件）
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
  // 题干与作答要求现在都是 textarea（题目卡里可编辑），按 placeholder 定位
  const title = ta.find(t => (t.placeholder||'').includes('自拟题目'))
  // 作答框是方格纸组件（GridPaper），用 class 定位比 placeholder 稳
  const answer = document.querySelector('textarea.grid-paper') || ta.find(t => (t.placeholder||'').includes('作答'))
  const req = ta.find(t => (t.placeholder||'').includes('观点明确'))
  setVal(title, '结合给定资料，围绕「养老刚需也是产业蓝海」自拟题目，写一篇文章')
  setVal(req, '观点明确，结构完整，语言流畅，1000 字左右')
  setVal(answer, ${JSON.stringify(ANSWER)})
  return { title: !!title, req: !!req, answer: !!answer, answerLen: (answer?.value||'').length }
})()
`)
console.log('② 表单填写：', JSON.stringify(filled))

// 3) 点「开始批改」
await sleep(1200)
const clicked = await evaluate(`
(() => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('答完了'))
  if (!btn) return { clicked: false, disabled: null, text: [...document.querySelectorAll('button')].map(b=>b.textContent.trim()).slice(0,12) }
  const disabled = btn.disabled
  btn.click()
  return { clicked: true, disabled }
})()
`)
console.log('③ 点击开始批改：', JSON.stringify(clicked))

// 4) 真实等待批改跑完（三师圆桌 = 3 次阅卷 + 可能的辩论 + 合议）
for (let i = 1; i <= 8; i++) {
  await sleep(4000)
  const stage = await evaluate(`
    (() => {
      const t = document.body.innerText
      const step = t.includes('批改中') ? 'grading' : t.includes('批改结果') ? 'result' : 'other'
      const h1 = document.querySelector('h1')?.textContent?.trim() || ''
      return { step, h1, len: t.length }
    })()
  `)
  console.log(`   [${i * 4}s] ${JSON.stringify(stage)}`)
  if (stage.step === 'result') break
}

// 5) 读结果
const text = await evaluate('document.body.innerText')
console.log('===== 结果页文本 =====')
console.log(text.slice(0, 2600))

console.log('===== 关键元素 =====')
const checks = await evaluate(`
(() => {
  const t = document.body.innerText
  const q = (s) => t.includes(s)
  const marked = document.querySelectorAll('[style*="border-bottom"]').length

  // 复盘卡：单独取出来验，别混在整页文本里（"改："这种字样别处也有）
  const sec = [...document.querySelectorAll('section')].find(
    (s) => s.querySelector('span')?.textContent?.trim() === '复盘卡')
  const card = sec ? {
    文本: sec.innerText,
    上榜条数: sec.querySelectorAll('span.w-5').length,
    有共识标记: sec.innerText.includes('位老师都提到'),
    有自检清单: sec.innerText.includes('下次动笔前，先按这'),
    有原文引用: sec.innerText.includes('—'),
    有改法: sec.innerText.includes('改：'),
  } : null

  return {
    进入结果页: q('批改结果'),
    总分: q('33') || q('/ 40'),
    合议说明: q('圆桌') || q('合议'),
    修改建议: q('修改建议'),
    逐句批注: q('逐句批注'),
    色标段落数: marked,
    已归档到docs: q('docs/practice'),
    只存本机: q('未写入 docs'),
    复盘卡: card,
  }
})()
`)
console.log(JSON.stringify(checks, null, 2))

// 6) 复盘卡断言：三师各自都标了「采分词缺失」与「空泛表态」，
//    归一化后应各自聚成一类并命中「多位老师都提到」——这正是 V3 聚合要证明的事。
const rc = checks.复盘卡
const rcOk = !!rc
  && rc.上榜条数 >= 1 && rc.上榜条数 <= 3
  && rc.有共识标记 && rc.有自检清单 && rc.有改法
console.log(rcOk ? '✓ 复盘卡：真实批改链路上渲染正确' : '✗ 复盘卡渲染有问题')
if (rc) console.log('   上榜条数=' + rc.上榜条数 + ' 共识=' + rc.有共识标记 + ' 清单=' + rc.有自检清单)

// 6) 截图：整页存档 + 第一屏特写（缩小图看不清细节）
const shotRes = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
if (shotRes?.data) {
  writeFileSync(shot, Buffer.from(shotRes.data, 'base64'))
  console.log('截图已保存：' + shot)
}
const topRes = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: 0, y: 0, width: 1280, height: 900, scale: 1 },
})
if (topRes?.data) {
  const topShot = shot.replace(/\.png$/, '-top.png')
  writeFileSync(topShot, Buffer.from(topRes.data, 'base64'))
  console.log('首屏截图已保存：' + topShot)
}

ws.close()
proc.kill()
process.exit(0)
