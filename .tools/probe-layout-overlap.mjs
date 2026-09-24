// 布局重叠探针：量「材料面板」与「作答区」的真实几何关系。
//   node .tools/probe-layout-overlap.mjs
//
// 起因：用户截图里材料荧光文字与作答格子纸疑似叠在同一片区域。
// 截图肉眼会骗人（内滚底部、页面滚动位置都会造成错觉），量 DOM 不骗。
//
// 依赖：frontend dev server（127.0.0.1:5273）。

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const WS = 'C:/Users/许/.workbuddy/binaries/node/workspace/node_modules/'
const puppeteer = createRequire(WS)('puppeteer-core')
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })

await page.goto('http://127.0.0.1:5273/#/practice', { waitUntil: 'networkidle2' })
await page.evaluate(() => {
  localStorage.setItem('llm_config', JSON.stringify({ api_key: 'sk-mock', base_url: 'http://127.0.0.1:9731/v1', model: 'mock-model' }))
})
await page.reload({ waitUntil: 'networkidle2' })
await sleep(3000)

// 填作答，让作答区进入"有内容"状态
await page.evaluate(() => {
  const ta = document.querySelector('textarea.grid-paper')
  if (!ta) return false
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, '测试作答内容，需要超过二十个字才能满足提交条件，所以这里再补一些字。')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})
await sleep(800)

const geo = await page.evaluate(() => {
  const secs = [...document.querySelectorAll('section')]
  const matSec = secs.find((s) => s.querySelector('[class*="col-span-5"]')) || secs.find((s) => s.textContent.includes('给定资料'))
  const ansSec = secs.find((s) => s.textContent.includes('我的作答'))
  const r = (el) => {
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) }
  }
  // 材料滚动容器与 Highlightable
  const matScroll = document.querySelector('[class*="max-h-[32rem]"]')
  const ta = document.querySelector('textarea.grid-paper')
  const hl = [...document.querySelectorAll('[class*="neu-inset"]')].find((e) => e.tagName !== 'TEXTAREA' && e.textContent.length > 100)
  return {
    viewport: { w: innerWidth, h: innerHeight },
    scrollY: Math.round(scrollY),
    matSection: r(matSec),
    ansSection: r(ansSec),
    matScroll: r(matScroll),
    gridTextarea: r(ta),
    bigHl: r(hl),
    overlap: matSec && ansSec ? (matSec.getBoundingClientRect().bottom > ansSec.getBoundingClientRect().top + 2) : null,
    taValueLen: ta ? ta.value.length : -1,
    bodyOverflow: document.documentElement.scrollHeight > innerHeight + 5,
  }
})
console.log(JSON.stringify(geo, null, 2))

await page.screenshot({ path: 'E:/code/bluepencil/.shots/layout-overlap.png', fullPage: false })
console.log('截图：E:/code/bluepencil/.shots/layout-overlap.png')
await browser.close()
