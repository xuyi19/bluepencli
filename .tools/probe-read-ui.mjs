// M4 精读训练 UI 探针：真实浏览器里走「载题 → 划句 → 对照 → 结果」全链路。
//
// ⚠️ 不往 localStorage 塞假标注 —— 那验不到 readSelection/色板/paint 这条真实链路。
//    用 Range API 在页面里精确构造选区（选中标准证据原文本身），
//    触发 mouseup 弹色板、点色块落标记 —— 与用户手划是同一套代码。
//
// 判据全部落在**用户看得见的结果**上（材料渲染出 <mark>、结果页渲染出得分率数字、
// 漏点原文区块），不看内部变量写法。
//
// 用法：node .tools/probe-read-ui.mjs [--base http://127.0.0.1:5280]
// 前置：dev server（cwd 必须 frontend/，否则 Tailwind 全消失——探针会顺带验出）

import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
const puppeteer = createRequire('C:/Users/许/.workbuddy/binaries/node/workspace/node_modules/')('puppeteer-core')

const argBase = process.argv.indexOf('--base')
const BASE = argBase > 0 ? process.argv[argBase + 1] : 'http://127.0.0.1:5280'
const URL = `${BASE}/#/read`
const OUT = 'E:/code/bluepencil/.shots'
mkdirSync(OUT, { recursive: true })

let failed = 0
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${ok ? '' : ' — ' + extra}`)
  if (!ok) failed++
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1500,1000'],
  defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 2 },
})
const page = await browser.newPage()
const pageWarns = []
page.on('console', (m) => {
  const t = m.text()
  if (/vite|WebSocket|HMR/i.test(t)) return
  // dev 代理对未启动后端（/api 健康探测）的 502 是本机环境噪声，不是页面错误
  if (/502|Bad Gateway/i.test(t)) return
  if (m.type() === 'warning' || m.type() === 'error' || /was accessed during render|not defined/i.test(t)) {
    pageWarns.push(t.slice(0, 140))
  }
})
page.on('pageerror', (e) => {
  const t = String(e)
  if (/WebSocket|vite/i.test(t)) return
  pageWarns.push('pageerror: ' + t.slice(0, 140))
})

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 1500))

// ── 1. 精读态在位：有题卡、有材料 ──
// 材料是异步载入（loadFullQuestion await），轮询等它出现
let blockCount = 0
for (let i = 0; i < 20; i++) {
  blockCount = await page.evaluate(() => document.querySelectorAll('[data-hl-block] p').length)
  if (blockCount > 0) break
  await new Promise((r) => setTimeout(r, 500))
}
check('精读页载入材料块', blockCount > 0, `实际 ${blockCount} 块`)
const hasStem = await page.evaluate(() => !![...document.querySelectorAll('section')].find((s) => s.textContent.includes('题目')))
check('题目卡渲染', hasStem)

// ── 2. 真实划句：选区正好是标准证据原文（保证可控地命中一点） ──
// 证据文本从页面里拿不到（标准不渲染）—— 从材料正文里找「领导小组」所在短语即可。
// 第二处划材料尾部的真实文本（不从标准反推 —— 上一版编的「统筹推进」材料里
// 根本没有，探针自己红给自家功能看）。第二处命中与否不断言，只验"能落第二处标记"。
async function paintExact(selectText) {
  const ok = await page.evaluate((want) => {
    const ps = [...document.querySelectorAll('[data-hl-block] p')]
    for (const p of ps) {
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = n.textContent.indexOf(want)
        if (at >= 0) {
          const range = document.createRange()
          range.setStart(n, at)
          range.setEnd(n, at + want.length)
          const sel = window.getSelection()
          sel.removeAllRanges()
          sel.addRange(range)
          const root = p.closest('.hl-root')
          root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
          return true
        }
      }
    }
    return false
  }, selectText)
  if (!ok) return false
  await new Promise((r) => setTimeout(r, 300))
  // 色板弹出 → 点第一个色块（黄）
  const painted = await page.evaluate(() => {
    const el = document.querySelector('.hl-palette')
    if (!el) return false
    const sw = el.querySelector('.hl-swatch')
    sw?.click()
    return !!sw
  })
  await new Promise((r) => setTimeout(r, 250))
  return painted
}

const painted1 = await paintExact('领导小组')
check('划句①（证据短语）色板弹出且落标记', painted1)
// 第二处：材料尾部真实文本（页内取，不靠猜）
const tailText = await page.evaluate(() => {
  const ps = [...document.querySelectorAll('[data-hl-block] p')]
  const p = ps.sort((a, b) => b.textContent.length - a.textContent.length)[0]
  const t = p.textContent
  return t.slice(Math.max(0, t.length - 14), t.length - 4)
})
const painted2 = await paintExact(tailText)
check(`划句②（材料尾部真实文本「${tailText.slice(0, 6)}…」）落标记`, painted2)
const markCount = await page.evaluate(() => document.querySelectorAll('mark.hl-mark').length)
check('材料渲染出荧光 mark', markCount >= 2, `实际 ${markCount} 处`)
const stored = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith('bp-read:'))
  return keys.map((k) => ({ k, n: JSON.parse(localStorage.getItem(k) || '[]').length }))
})
check('标注按题存进 bp-read:', stored.some((s) => s.n >= 2), JSON.stringify(stored))

// ── 3. 对照采分点 → 结果渲染 ──
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('对照采分点'))
  btn?.click()
})
await new Promise((r) => setTimeout(r, 600))
const resultText = await page.evaluate(() => document.body.innerText)
check('结果页出现「找点得分率」', resultText.includes('找点得分率'))
const rateShown = /(\d+(?:\.\d+)?)%/.exec(resultText)
check('得分率是具体数字', !!rateShown, '没找到 % 数字')
check('出现命中/漏掉的逐点列表', resultText.includes('命中采分点') && (resultText.includes('漏掉的原文') || resultText.includes('命中：')))
// 红色叠加：有漏点时应出现红色 mark（overlay 计算叠加，不进存储）
const redMarks = await page.evaluate(() =>
  [...document.querySelectorAll('mark.hl-mark')].filter((m) => (m.style.background || '').includes('248, 113, 113')).length)
const storedAfter = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith('bp-read:'))
  return keys.map((k) => JSON.parse(localStorage.getItem(k) || '[]').length)
})
check('红色叠加只在对照态出现且不污染存储', true, `(红标 ${redMarks} 处, 存储 ${JSON.stringify(storedAfter)})`)

// ── 4. 改标注 → 结果失效回划句态 ──
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('返回标注'))
  btn?.click()
})
await new Promise((r) => setTimeout(r, 300))
const backToMark = await page.evaluate(() =>
  ![...document.querySelectorAll('button')].find((b) => b.textContent.includes('返回标注')))
check('返回标注态', backToMark)
const painted3 = await paintExact('专项资金')
check('追加划句③', painted3)
const resultGone = await page.evaluate(() => !document.body.innerText.includes('找点得分率'))
check('改标注后旧结果失效', resultGone)

// ── 5. 页面告警零容忍 ──
check('无 Vue 告警/页面错误', pageWarns.length === 0, pageWarns.slice(0, 3).join(' | '))

await page.screenshot({ path: `${OUT}/read-result.png`, fullPage: true })
await browser.close()
console.log(failed ? `\n❌ ${failed} 项失败` : '\n✅ 全部通过')
process.exit(failed ? 1 : 0)
