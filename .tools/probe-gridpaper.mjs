// 探针：检查练习页网格纸的渲染与「每行是否真的刚好 25 字」。
//
// 关键验证思路：往 textarea 里填 24 / 25 / 26 个字，量它的 scrollHeight ÷ lineHeight
// 得到**浏览器实际折行数**。
//   24 字 → 1 行
//   25 字 → 1 行   ← 若这里是 2 行，说明格宽没算对，格线必然错位
//   26 字 → 2 行
// 这比肉眼看截图可靠得多。
//
// 用法：node probe-gridpaper.mjs [路由]

const BASE = 'http://127.0.0.1:5273'
const PORT = 9338
const ROUTE = process.argv[2] || '/practice'
const OUT = 'E:/code/bluepencil/.shots'

const { spawn } = await import('node:child_process')
const { existsSync, writeFileSync } = await import('node:fs')

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-probe-gp',
  '--window-size=1440,1000',
  'about:blank',
])

async function wsUrlOf() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch { /* 等待 */ }
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
const send = (method, params = {}) => new Promise((resolve) => {
  const myId = ++id
  pending.set(myId, resolve)
  ws.send(JSON.stringify({ id: myId, method, params }))
})
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  })
  if (exceptionDetails) throw new Error(exceptionDetails.text + ' :: ' + (exceptionDetails.exception?.description || ''))
  return result?.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: `${BASE}/#${ROUTE}` })
await sleep(3500)

const info = await evaluate(`
(() => {
  const gp = document.querySelector('textarea.grid-paper')
  if (!gp) {
    const tas = [...document.querySelectorAll('textarea')].map(t => (t.className || '').slice(0, 60))
    return { 找到: false, 页面所有textarea: tas }
  }
  const cs = getComputedStyle(gp)
  const r = gp.getBoundingClientRect()
  const cell = parseFloat(cs.getPropertyValue('--cell'))
  return {
    找到: true,
    容器宽: Math.round(r.width),
    格宽: +cell.toFixed(2),
    格宽x25: +(cell * 25).toFixed(2),
    字距: cs.letterSpacing,
    字号: cs.fontSize,
    行高: cs.lineHeight,
    字体: cs.fontFamily.slice(0, 30),
    有格线: cs.backgroundImage.includes('repeating-linear-gradient'),
  }
})()
`)
console.log('① 渲染检查：', JSON.stringify(info, null, 2))

if (info.找到) {
  const diag = await evaluate(`
(async () => {
  const gp = document.querySelector('textarea.grid-paper')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  const cs = getComputedStyle(gp)
  const rowH = parseFloat(cs.lineHeight)

  // 诊断：本环境下一个全角字实际占多少 em（应为 1；明显偏离说明字体回退了）
  let emW
  try {
    const c = document.createElement('canvas').getContext('2d')
    c.font = '100px ' + cs.fontFamily
    emW = +(c.measureText('字').width / 100).toFixed(3)
  } catch { emW = '测量失败' }

  const out = []
  for (const n of [24, 25, 26, 50, 51]) {
    setter.call(gp, '字'.repeat(n))
    gp.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    // ⚠️ 不能直接读 scrollHeight：它被 min-height 撑着，永远等于最少行数的高度。
    //    必须先把 height 压到 0，clientHeight 归零后 scrollHeight 才是纯内容高度。
    const saved = gp.style.height
    gp.style.height = '0px'
    const contentH = gp.scrollHeight
    gp.style.height = saved
    out.push({ 字数: n, 实际行数: Math.round(contentH / rowH), 期望行数: Math.ceil(n / 25) })
  }
  return { 全角字占em: emW, 行高: rowH, 结果: out }
})()
`)
  console.log(`② 诊断：一个全角字占 ${diag.全角字占em} em，行高 ${diag.行高}px`)
  console.log('③ 折行检查：')
  let allOk = true
  for (const r of diag.结果) {
    const ok = r.实际行数 === r.期望行数
    if (!ok) allOk = false
    console.log(`   ${r.字数} 字 → 实际 ${r.实际行数} 行 / 期望 ${r.期望行数} 行  ${ok ? '✓' : '✗ 错位'}`)
  }
  console.log(allOk ? '\n结论：格宽与列数严丝合缝 ✓' : '\n结论：存在错位 ✗')

  // 填一段真实文言文，截个图看格线视觉
  await evaluate(`
(async () => {
  const gp = document.querySelector('textarea.grid-paper')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  const t = '老吾老，以及人之老。截至2025年末，我国60周岁及以上老年人口已达32338万人，占总人口的23%。庞大的银发群体既是民生保障的重点，也是消费市场新的增长极。'
  setter.call(gp, t)
  gp.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 400))
  window.scrollTo(0, 0)
  return 'ok'
})()
`)
  await sleep(600)

  // 全页截图
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) {
    writeFileSync(`${OUT}/gridpaper-closeup.png`, Buffer.from(shot.data, 'base64'))
    console.log('截图：gridpaper-closeup.png')
  }

  // 局部 4 倍放大：缩略图上数不清格线，必须放大才看得准对齐
  // 先把纸滚到视口顶部，这样 rect 就是稳定的取样坐标
  await evaluate(`document.querySelector('textarea.grid-paper').scrollIntoView({ block: 'start' })`)
  await sleep(600)
  const rect = await evaluate(`
(() => {
  const r = document.querySelector('textarea.grid-paper').getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height, scrollY: window.scrollY }
})()
`)
  console.log('④ 取样坐标：', JSON.stringify(rect))
  // ⚠️ clip 要的是**文档坐标**（页面滚动也要算进去），不是 getBoundingClientRect 的视口坐标
  const zoom = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: Math.round(rect.x),
      y: Math.round(rect.y + rect.scrollY) + 2,
      width: 240,
      height: 96,
      scale: 4,
    },
  })
  if (zoom?.data) {
    writeFileSync(`${OUT}/gridpaper-zoom.png`, Buffer.from(zoom.data, 'base64'))
    console.log(`截图：gridpaper-zoom.png（纸左上角 240×96 CSS px，4 倍放大；格宽应约 ${(rect.w / 25).toFixed(1)}px）`)
  }
}

ws.close()
proc.kill()
process.exit(0)
