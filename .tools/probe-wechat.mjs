// 验证微信引流四处入口真的可用。
//
//   node .tools/probe-wechat.mjs
//
// 为什么不能只看构建通过：
//   二维码是 <img :src> 引资源，**路径错了页面也不报错**，只是显示一个裂图占位符。
//   构建成功 ≠ 图能显示。这里逐处检查 img.complete && naturalWidth > 0，
//   只有真的解码出像素才算过。
//
// 前置：dev server 跑在 5273。

const BASE = 'http://127.0.0.1:5273'
const PORT = 9680 + Math.floor(Math.random() * 200)

const { spawn } = await import('node:child_process')
const { existsSync, writeFileSync, mkdirSync } = await import('node:fs')

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const proc = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/cdp-wechat-profile',
  '--window-size=1280,1400',
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

/** 页面上所有二维码图片的加载情况 —— 核心断言靠它 */
const QR_STATE = `
(() => {
  const imgs = [...document.querySelectorAll('img')].filter(i => (i.alt || '').includes('二维码'))
  return imgs.map(i => ({
    alt: i.alt,
    // complete 为 true 且 naturalWidth > 0 才算真的解码出来了；否则是裂图
    loaded: !!(i.complete && i.naturalWidth > 0),
    w: i.naturalWidth,
    h: i.naturalHeight,
    src: (i.getAttribute('src') || '').slice(0, 46),
  }))
})()
`

const results = {}
const failures = []

// ── ① 侧边栏入口 → 弹层 ───────────────────────────────
await send('Page.navigate', { url: `${BASE}/#/` })
await sleep(4000)

const sidebarBtn = await evaluate(`
  (() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('加微信'))
    return btn ? { found: true, text: btn.textContent.trim() } : { found: false }
  })()
`)
console.log('① 侧边栏入口：', JSON.stringify(sidebarBtn))
results['侧边栏入口'] = sidebarBtn.found
if (!sidebarBtn.found) failures.push('侧边栏没有「加微信 / 交流群」按钮')

const opened = await evaluate(`
  (() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('加微信'))
    if (!btn) return { ok: false }
    btn.click()
    return { ok: true }
  })()
`)
await sleep(1500)

const dialog = await evaluate(`
  (() => {
    const d = document.querySelector('[role="dialog"]')
    return {
      存在: !!d,
      文字: d ? d.innerText.replace(/\\s+/g, ' ').slice(0, 200) : '',
      图片: ${QR_STATE},
    }
  })()
`)
console.log('\n② 弹层：', JSON.stringify({ 存在: dialog.存在, 文字: dialog.文字 }, null, 2))
console.log('   弹层内图片：', JSON.stringify(dialog.图片, null, 2))
results['弹层打开'] = dialog.存在
results['弹层二维码加载'] = dialog.图片.length >= 2 && dialog.图片.every((i) => i.loaded)
if (!dialog.存在) failures.push('点侧边栏按钮没有弹出弹层')
// 弹层里应该有个人码 + 群码两张（群码未过期时）
if (dialog.图片.length < 2) failures.push(`弹层里二维码只有 ${dialog.图片.length} 张，期望 2 张`)
if (dialog.图片.some((i) => !i.loaded)) failures.push('弹层里有二维码没加载出来（裂图）')

// 截图留证
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
if (shot?.data) {
  mkdirSync('E:/code/bluepencil/.shots', { recursive: true })
  writeFileSync('E:/code/bluepencil/.shots/probe-wechat-dialog.png', Buffer.from(shot.data, 'base64'))
  console.log('   截图：E:/code/bluepencil/.shots/probe-wechat-dialog.png')
}

// ── ③ ESC 关闭 ────────────────────────────────────────
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(900)
const closed = await evaluate(`document.querySelector('[role="dialog"]') ? 'still-open' : 'closed'`)
console.log('\n③ ESC 关闭：', closed)
results['ESC 可关闭'] = closed === 'closed'
if (closed !== 'closed') failures.push('ESC 没能关掉弹层')

// ── ④ 首页作者区按钮 ──────────────────────────────────
const homeQr = await evaluate(`
  (() => {
    const t = document.body.innerText
    return { 按钮: t.includes('加微信 / 交流群'), 页脚署名: t.includes('${'xuconghui_03@qq.com'}') }
  })()
`)
console.log('④ 首页：', JSON.stringify(homeQr))
results['首页入口'] = homeQr.按钮

// ── ⑤ 题库页「怎么获取？」 ─────────────────────────────
await send('Page.navigate', { url: `${BASE}/#/questions` })
await sleep(3500)
const questionsBefore = await evaluate(`document.body.innerText.includes('怎么获取？')`)
const expanded = await evaluate(`
  (() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('怎么获取'))
    if (!btn) return { ok: false }
    btn.click()
    return { ok: true }
  })()
`)
await sleep(1500)
const questionsQr = await evaluate(`
  (() => {
    const t = document.body.innerText
    return {
      有获取说明: t.includes('获取私有题库包'),
      二维码: ${QR_STATE},
    }
  })()
`)
console.log('\n⑤ 题库页：展开前有入口 =', questionsBefore, '| 点击 =', JSON.stringify(expanded))
console.log('   ', JSON.stringify(questionsQr, null, 2))
results['题库页入口'] = questionsBefore
results['题库页二维码加载'] = questionsQr.二维码.length >= 2 && questionsQr.二维码.every((i) => i.loaded)
if (!questionsBefore) failures.push('题库页没有「怎么获取？」入口')
if (!results['题库页二维码加载']) failures.push('题库页二维码缺失或裂图')

// ── ⑥ 设置页「关于」 ──────────────────────────────────
await send('Page.navigate', { url: `${BASE}/#/settings` })
await sleep(3500)
const settingsQr = await evaluate(`
  (() => {
    const t = document.body.innerText
    return {
      有关于块: t.includes('关于'),
      有作者: t.includes('xuconghui_03@qq.com'),
      二维码: ${QR_STATE},
    }
  })()
`)
console.log('\n⑥ 设置页：', JSON.stringify({ 有关于块: settingsQr.有关于块, 有作者: settingsQr.有作者 }, null, 2))
console.log('   ', JSON.stringify(settingsQr.二维码, null, 2))
results['设置页二维码加载'] = settingsQr.二维码.length >= 2 && settingsQr.二维码.every((i) => i.loaded)
if (!results['设置页二维码加载']) failures.push('设置页二维码缺失或裂图')

// ── ⑦ 群二维码有效期文案 ──────────────────────────────
const expireText = await evaluate(`
  (() => {
    const t = document.body.innerText
    const m = t.match(/群聊「[^」]+」[^\\n]*/)
    const n = t.match(/长期有效/)
    const o = t.match(/群二维码已过期/)
    return { 群标签: m ? m[0].trim() : '', 长期有效: !!n, 已过期降级: !!o }
  })()
`)
console.log('\n⑦ 有效期文案：', JSON.stringify(expireText))
results['有效期文案'] = !!expireText.群标签 && expireText.长期有效
// 二选一：要么显示群码+有效期，要么显示过期降级说明。两者都没有才是问题。
if (!expireText.群标签 && !expireText.已过期降级) failures.push('群码既没显示有效期也没显示过期降级')

// ── 汇总 ──────────────────────────────────────────────
console.log('\n===== 汇总 =====')
for (const [k, v] of Object.entries(results)) console.log(`${v ? '✓' : '✗'} ${k}`)
if (failures.length) {
  console.log('\n失败项：')
  failures.forEach((f) => console.log('  - ' + f))
}

proc.kill()
process.exit(failures.length ? 1 : 0)
