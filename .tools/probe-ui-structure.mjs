// 本轮 UI 优化（荧光 8 色 / 侧栏图标 / 老师页 / 答题页布局）的截图验收。
// 输出 .shots/ui2-*.png，并断言关键结构性变化真实存在：
//   侧栏：实战组在「学习」组之前、每项有 svg 图标
//   老师页：列表卡有权重徽章、活跃项有色条
//   荧光：色板 8 个色块
import { createRequire } from 'node:module'
import { mkdirSync, statSync } from 'node:fs'
const puppeteer = createRequire('C:/Users/许/.workbuddy/binaries/node/workspace/node_modules/')('puppeteer-core')

const OUT = 'E:/code/bluepencil/.shots'
mkdirSync(OUT, { recursive: true })

let failed = 0
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${ok ? '' : ' — ' + extra}`)
  if (!ok) failed++
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox'],
  defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 2 },
})
const page = await browser.newPage()
// 注假 Key 再加载：一屏布局断言要测「配置后」的形态——
// 没 Key 时页面多一条「去配置」横幅，会把整页顶出视口（那是未配置态的合法表现）。
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('llm_config', JSON.stringify({ api_key: 'probe-fake-key' }))
})
await page.goto('http://127.0.0.1:5279/#/practice', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 2200))

// ── 侧栏结构 ──
const side = await page.evaluate(() => {
  const nav = document.querySelector('nav')
  if (!nav) return null
  const heads = [...nav.querySelectorAll('.tracking-widest')]
    .map((d) => d.textContent.trim())
  const links = [...nav.querySelectorAll('a')]
  return {
    heads,
    order: links.map((a) => a.textContent.trim()),
    withIcon: links.filter((a) => a.querySelector('svg')).length,
  }
})
check('组头顺序 = 实战→学习→复盘→关于（首页无组头）',
  JSON.stringify(side?.heads) === JSON.stringify(['实战', '学习', '复盘', '关于']), JSON.stringify(side?.heads))
check('首页条目排第一', side?.order?.[0] === '首页', JSON.stringify(side?.order))
check('实战组紧跟首页（练习批改/真题模式/考场模式）',
  JSON.stringify(side?.order?.slice(1, 4)) === JSON.stringify(['练习批改', '真题模式', '考场模式']), JSON.stringify(side?.order))
check('每个导航项都有图标', side?.withIcon === side?.order?.length, `${side?.withIcon}/${side?.order?.length}`)
await page.evaluate(() => window.scrollTo({ top: 0 }))
await new Promise((r) => setTimeout(r, 300))
await page.screenshot({ path: `${OUT}/ui2-sidebar.png` })

// ── 答题页布局（题目要求收窄到 2/7）──
const cols = await page.evaluate(() => {
  const grid = document.querySelector('[data-hl-block]')?.closest('section')?.parentElement
  const secs = grid ? [...grid.querySelectorAll(':scope > section')] : []
  return secs.map((s) => Math.round(s.getBoundingClientRect().width))
})
check('材料面板明显宽于题目面板（≥2 倍）', cols.length === 2 && cols[0] >= cols[1] * 2, JSON.stringify(cols))

// ── 上排定高：材料面板吃满视口剩余高度（作答区才不会随材料长短上下跳）──
const hs = await page.evaluate(() => {
  const sec = document.querySelector('[data-hl-block]')?.closest('section')
  const grid = sec?.parentElement
  const doc = document.scrollingElement
  return {
    secH: Math.round(sec?.getBoundingClientRect().height || 0),
    gridH: Math.round(grid?.getBoundingClientRect().height || 0),
    pageOverflow: doc.scrollHeight > doc.clientHeight + 2,
    pageOverflowPx: doc.scrollHeight - doc.clientHeight,
    scrollable: (() => {
      const el = sec?.querySelector('.overflow-y-auto')
      return el ? el.scrollHeight > el.clientHeight || el.clientHeight > 400 : false
    })(),
  }
})
// ── 一屏布局：材料面板是一屏 flex 剩余空间的自适应高度（旧设计是 calc 定高 ≥480）。
//    v0.25.0 起答题页整页不滚（材料独滚），面板高度跟着视口走——
//    断言改为「够用的高度」+ 内部滚动生效，钉的是可用性而不是某个实现值。
check('材料面板高度 ≥360px（一屏自适应）', hs.secH >= 360, `面板 ${hs.secH}px / 栅格 ${hs.gridH}px`)
check('材料面板与作答区、提交条同屏（整页不滚）', hs.pageOverflow !== true, `页面溢出 ${hs.pageOverflowPx ?? 0}px`)
check('材料面板内部滚动生效', hs.scrollable, JSON.stringify(hs))

// ── 提纲模块：存在、可展开、输入会落 localStorage ──
const outline = await page.evaluate(() => {
  const d = [...document.querySelectorAll('details')].find((x) => x.textContent.includes('提纲'))
  if (!d) return null
  const ta = d.querySelector('textarea')
  if (!ta) return { exists: true, ta: false }
  return { exists: true, ta: true }
})
check('提纲模块存在且带输入框', outline?.exists && outline?.ta, JSON.stringify(outline))
if (outline?.ta) {
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('details')].find((x) => x.textContent.includes('提纲'))
    d.open = true
  })
  await page.click('details textarea')
  await page.type('details textarea', '立论：减负贵在治本；分论点：考核导向、资源下沉；收束：群众获得感。')
  await new Promise((r) => setTimeout(r, 400))
  const saved = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('bp-outline:'))
    return key ? localStorage.getItem(key) : null
  })
  check('提纲输入按题目落库', saved && saved.includes('分论点'), String(saved).slice(0, 30))
  // 收尾清理：探针注入的提纲不留给用户
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('bp-outline:'))
    if (key) localStorage.removeItem(key)
  })
}

// ── 荧光色板 8 色 ──
const blockCount = await page.evaluate(() => document.querySelectorAll('[data-hl-block] p').length)
check('页面有材料可划', blockCount > 0, `实际 ${blockCount}`)
const swatches = await page.evaluate(() => {
  // 不真划：直接看 Highlightable 渲染的色块数（从源码断言）——用组件挂载后的 mark 渲染验证太绕，
  // 这里以 probe-highlight-ui 的交互用例为准，此处只验色板常量
  return null
})
await page.evaluate(() => {
  const sec = [...document.querySelectorAll('section')].find((s) => s.querySelector('[data-hl-block]'))
  sec?.scrollIntoView({ block: 'center' })
})
await new Promise((r) => setTimeout(r, 400))
// 程序化触发一次色板（交互路径在 probe-highlight-ui 已有真鼠标用例）
await page.evaluate(() => {
  const root = document.querySelector('.hl-root')
  const ps = [...root.querySelectorAll('[data-hl-block] p')]
  const p = ps.sort((a, b) => b.textContent.length - a.textContent.length)[0]
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
  let n = w.nextNode(); while (n && n.textContent.trim().length < 10) n = w.nextNode()
  const r = document.createRange(); r.setStart(n, 2); r.setEnd(n, 10)
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
  root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 400))
const nSw = await page.evaluate(() => document.querySelectorAll('.hl-palette .hl-swatch').length)
check('色板 8 个色块', nSw === 8, `实际 ${nSw}`)
await page.keyboard.press('Escape')
await page.evaluate(() => window.getSelection()?.removeAllRanges())

// ── 老师页 ──
await page.goto('http://127.0.0.1:5279/#/teachers', { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 1500))
const t = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter((b) => b.querySelector('.rounded-xl'))
  const badges = [...document.querySelectorAll('button span')].filter((s) => /^×\d/.test(s.textContent)).length
  const bars = [...document.querySelectorAll('button div')].filter((d) => d.className.includes('absolute left-0')).length
  return { cards: btns.length, badges, bars }
})
check('老师列表 5 张卡', t?.cards === 5, `实际 ${t?.cards}`)
check('每张卡有权重徽章', t?.badges === 5, `实际 ${t?.badges}`)
check('活跃卡有老师色边条', t?.bars === 1, `实际 ${t?.bars}`)
await page.screenshot({ path: `${OUT}/ui2-teachers.png` })

for (const f of ['ui2-sidebar.png', 'ui2-teachers.png']) {
  const p = `${OUT}/${f}`
  try { check(`截图 ${f}`, statSync(p).size > 20000, `${statSync(p).size}B`) } catch { check(`截图 ${f}`, false, '不存在') }
}

await browser.close()
console.log(failed ? `有 ${failed} 项失败` : '全部通过')
process.exit(failed ? 1 : 0)
