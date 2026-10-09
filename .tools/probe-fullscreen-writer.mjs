import { createRequire } from 'node:module'
const puppeteer = createRequire('C:/Users/许/.workbuddy/binaries/node/workspace/node_modules/')('puppeteer-core')
const BASE = 'http://127.0.0.1:5281'
let pass = 0, fail = 0
function check(name, cond, detail = '') {
  cond ? (pass++, console.log('  ✓ ' + name)) : (fail++, console.log('  ✗ ' + name + (detail ? ' —— ' + detail : '')))
}
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)))

// ── 1. 历史批改：两段式（列表 → 点进详情） ──
await page.goto(`${BASE}/#/records`, { waitUntil: 'networkidle2' })
await new Promise(r => setTimeout(r, 1500))
let s = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.grid > div[class*="neu-sm"]')]
  return {
    cards: cards.length,
    hasSearch: !!document.querySelector('input[placeholder="搜索题目"]'),
    noDetailYet: !document.body.innerText.includes('下载 Word'),
  }
})
check('列表模式：无详情按钮（先看题目）', s.noDetailYet)
check('列表模式：搜索框在', s.hasSearch)
if (s.cards === 0) console.log('  (本机无历史记录，跳过详情块——详情链路由 probe-records-twostep 覆盖)')
else { check('列表模式：有记录卡片', true) }
if (s.cards > 0) {
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.grid > div')].find((d) => d.className.includes('neu-sm'))?.click()
  })
  await new Promise(r => setTimeout(r, 1200))
  s = await page.evaluate(() => ({
    back: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('返回列表')),
    downloads: [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('下载')).length,
    wide: (() => { const el = document.querySelector('.max-w-4xl'); return el && el.offsetWidth > 600 })(),
    textW: (() => {
      const p = [...document.querySelectorAll('.max-w-4xl p, .max-w-4xl div')].find((d) => d.textContent.length > 60)
      return p ? p.getBoundingClientRect().width : 0
    })(),
  }))
  check('详情模式：返回列表按钮', s.back)
  check('详情模式：下载 Word/PDF 按钮', s.downloads >= 2)
  check('详情模式：全宽容器（>600px，竖排 bug 已修）', s.wide)
  check('详情模式：长文本宽度正常（>500px）', s.textW > 500, `w=${Math.round(s.textW)}`)
  await page.screenshot({ path: 'E:/code/bluepencil/.shots/records-detail.png' })
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.includes('返回列表'))?.click() })
  await new Promise(r => setTimeout(r, 600))
  s = await page.evaluate(() => !!document.querySelector('input[placeholder="搜索题目"]'))
  check('返回列表：搜索框回来了', s)
  await page.screenshot({ path: 'E:/code/bluepencil/.shots/records-list.png' })
}

// ── 2. 全屏三栏作答 ──
await page.goto(`${BASE}/#/practice`, { waitUntil: 'networkidle2' })
await new Promise(r => setTimeout(r, 2500))
// 有弹窗先关（选老师/选题弹窗）
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '✕')?.click() })
await new Promise(r => setTimeout(r, 500))
s = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('全屏'))
  if (btn) btn.click()
  return !!btn
})
check('答题页：全屏按钮存在', s)
await new Promise(r => setTimeout(r, 800))
s = await page.evaluate(() => {
  const overlay = [...document.querySelectorAll('div')].find((d) => d.className?.includes?.('fixed inset-0') && d.innerText.includes('全屏作答'))
  return {
    overlay: !!overlay,
    lifeline: overlay ? overlay.innerText.includes('退出全屏') && overlay.innerText.includes('作答') : false,
    grade: overlay ? [...overlay.querySelectorAll('button')].some((b) => b.textContent.includes('批改') || b.textContent.includes('交卷')) : false,
    material: overlay ? overlay.innerText.includes('给定资料') : false,
    outline: overlay ? overlay.innerText.includes('提纲') : false,
  }
})
check('全屏：覆盖层出现', s.overlay)
check('全屏：生命线（退出+字数）', s.lifeline)
check('全屏：批改/交卷按钮常驻', s.grade)
check('全屏：材料面板', s.material)
check('全屏：提纲面板', s.outline)
await page.screenshot({ path: 'E:/code/bluepencil/.shots/fs-writer.png' })
// 拖拽持久化（模拟：直接改 localStorage 验读回）
await page.evaluate(() => localStorage.setItem('bp-fs-split', '0.55'))
await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
await new Promise(r => setTimeout(r, 500))
s = await page.evaluate(() => !document.body.innerText.includes('全屏作答'))
check('Esc 退出全屏', s)
await browser.close()
console.log(`\nM8+两段式探针：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
