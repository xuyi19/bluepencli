// M2 素材本 UI 探针：载入 / 筛选 / 收藏 / 打印排版全链路。
//
// 打印验证的关键招：page.pdf() 在 headless Chrome 里**按 print 媒体渲染** ——
// @media print 的换装样式（隐藏侧边栏、衬线、题头）真实生效才能产出 PDF，
// 这是"打印排版好看"最接近真实的判据（比截图更严：分页都算出来了）。
//
// 用法：node .tools/probe-lexicon-ui.mjs [--base http://127.0.0.1:5280]

import { mkdirSync, statSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const puppeteer = createRequire('C:/Users/许/.workbuddy/binaries/node/workspace/node_modules/')('puppeteer-core')

const argBase = process.argv.indexOf('--base')
const BASE = argBase > 0 ? process.argv[argBase + 1] : 'http://127.0.0.1:5280'
const URL = `${BASE}/#/lexicon`
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
  if (/502|Bad Gateway/i.test(t)) return // dev 代理对未启动后端的健康探测噪声
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
await new Promise((r) => setTimeout(r, 1200))

// 清掉上次探针残留的收藏（localStorage 在 headless 档案里持久）
await page.evaluate(() => localStorage.removeItem('bp-fav-lexicon'))
await page.reload({ waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 1200))

// ── 1. 词条渲染 ──
const itemCount = await page.evaluate(() => document.querySelectorAll('.lex-item').length)
check('全量词条渲染（135 条）', itemCount === 135, `实际 ${itemCount}`)
const themeCount = await page.evaluate(() => document.querySelectorAll('.lex-theme').length)
check('九大主题分组齐全', themeCount === 9, `实际 ${themeCount}`)

// ── 2. 主题筛选 ──
await page.evaluate(() => {
  const chip = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('民生保障'))
  chip?.click()
})
await new Promise((r) => setTimeout(r, 300))
const msCount = await page.evaluate(() => document.querySelectorAll('.lex-item').length)
check('主题筛选（民生保障 15 条）', msCount === 15, `实际 ${msCount}`)
await page.evaluate(() => {
  const chip = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('民生保障'))
  chip?.click()
})
await new Promise((r) => setTimeout(r, 300))

// ── 3. 收藏链路 ──
await page.evaluate(() => document.querySelector('.lex-item .no-print')?.click())
await new Promise((r) => setTimeout(r, 200))
const favStored = await page.evaluate(() => JSON.parse(localStorage.getItem('bp-fav-lexicon') || '[]'))
check('收藏写入 localStorage（bp-fav-lexicon）', favStored.length === 1, `实际 ${JSON.stringify(favStored)}`)
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('我的收藏'))
  tab?.click()
})
await new Promise((r) => setTimeout(r, 300))
const favCount = await page.evaluate(() => document.querySelectorAll('.lex-item').length)
check('收藏 tab 只显示收藏条目', favCount === 1, `实际 ${favCount}`)

// ── 4. 打印排版：page.pdf() 按 print 媒体渲染 ──
// 收藏态打一份（1 条），再切回全部打整册 —— 两种打印产物都要能出
const pdfFav = `${OUT}/lexicon-print-fav.pdf`
await page.pdf({ path: pdfFav, format: 'A4', printBackground: false })
const sizeFav = statSync(pdfFav).size
check('收藏打印出 PDF', sizeFav > 5000, `${sizeFav} bytes`)

await page.evaluate(() => {
  const tab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '全部')
  tab?.click()
})
await new Promise((r) => setTimeout(r, 300))
// print 媒体检样式的判据（PDF 二进制里搜中文不成立——文本流是压缩+CID 编码）：
// 题头必须从 none 变 block、侧边栏必须 display:none，这两个才是"打印换装生效"
await page.emulateMediaType('print')
const printStyles = await page.evaluate(() => ({
  head: getComputedStyle(document.querySelector('.lex-root .print-head')).display,
  aside: getComputedStyle(document.querySelector('aside')).display,
}))
await page.emulateMediaType('screen')
check('打印媒体下题头显示', printStyles.head === 'block', `实际 ${printStyles.head}`)
check('打印媒体下侧边栏隐藏', printStyles.aside === 'none', `实际 ${printStyles.aside}`)
const pdfAll = `${OUT}/lexicon-print-sample.pdf`
await page.pdf({ path: pdfAll, format: 'A4', printBackground: false })
const sizeAll = statSync(pdfAll).size
check('整册打印出 PDF', sizeAll > 20000, `${sizeAll} bytes`)
const pages = (readFileSync(pdfAll).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
check('整册 PDF 多页（≥2 页）', pages >= 2, `实际 ${pages} 页`)

// ── 5. 页面告警零容忍 ──
check('无 Vue 告警/页面错误', pageWarns.length === 0, pageWarns.slice(0, 3).join(' | '))

await page.screenshot({ path: `${OUT}/lexicon-view.png`, fullPage: false })
await browser.close()
console.log(failed ? `\n❌ ${failed} 项失败` : '\n✅ 全部通过')
process.exit(failed ? 1 : 0)
