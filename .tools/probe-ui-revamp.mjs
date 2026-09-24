/**
 * UI 探针：本轮三处改动的真机验证
 *   ① 老师页 Markdown 真渲染（批改指令 + 原文全文两个视图）
 *   ② 批改指令/原文全文 切换的高亮态
 *   ③ 答题页：进页弹分类选题弹窗、材料独滚、页面不滚
 * 用法：node .tools/probe-ui-revamp.mjs   （dev server 5273）
 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/许/.workbuddy/binaries/node/workspace/node_modules/')
const puppeteer = require('puppeteer-core')

const BASE = 'http://127.0.0.1:5273'
const results = []
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail })
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })

// ---------- ① 老师页 ----------
await p.goto(BASE + '/#/teachers', { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 2000))
await p.screenshot({ path: 'E:/code/bluepencil/.shots/revamp-teachers-method.png' })

const mdRendered = await p.evaluate(() => {
  const body = document.body.innerText
  const hasBoldMark = /\*\*/.test(body)          // ** 不该再裸露
  const hasListDot = !!document.querySelector('.md-view ul li')
  const hasHeading = !!document.querySelector('.md-view .font-semibold')
  return { hasBoldMark, hasListDot, hasHeading }
})
ok('老师页·批改指令无裸 ** 记号', !mdRendered.hasBoldMark)
ok('老师页·列表被渲染成 <li>', mdRendered.hasListDot)

// 切到原文全文：active 按钮应有实底背景色（老师主题色）
const viewBtns = await p.$$('button')
let rawBtn = null
for (const btn of viewBtns) {
  const t = await btn.evaluate((el) => el.textContent)
  if (t.includes('原文全文')) rawBtn = btn
}
if (rawBtn) {
  await rawBtn.click()
  await new Promise((r) => setTimeout(r, 1500))
  const rawState = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const active = btns.find((b) => b.textContent.includes('原文全文') && b.style.background)
    const heading = [...document.querySelectorAll('.md-view .font-semibold')].map((h) => h.textContent.trim())
    return { activeFound: !!active, bg: active?.style.background || '', headings: heading.slice(0, 5) }
  })
  ok('老师页·原文全文切换有实底高亮', rawState.activeFound, rawState.bg)
  ok('老师页·原文 ## 标题被渲染', rawState.headings.length > 0, rawState.headings.join(' | '))
  const rawMark = await p.evaluate(() => /(^|\n)\s*#{1,3}\s|\*\*/.test(document.querySelector('.md-view')?.innerText || ''))
  ok('老师页·原文无裸 #/** 记号', !rawMark)
  await p.screenshot({ path: 'E:/code/bluepencil/.shots/revamp-teachers-raw.png' })
} else {
  ok('老师页·找到「原文全文」按钮', false)
}

// ---------- ③ 答题页 ----------
// 先注入假 Key：没配 Key 时页面会多一条「去配置」横幅，把一屏布局顶出视口——
// 那是未配置态的合法表现，不是要测的布局状态。测「配置后的正常形态」。
await p.evaluate(() => localStorage.setItem('llm_config', JSON.stringify({ api_key: 'probe-fake-key' })))
await p.goto(BASE + '/#/practice', { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 2500))
await p.screenshot({ path: 'E:/code/bluepencil/.shots/revamp-practice-modal.png' })

const modal = await p.evaluate(() => {
  const text = document.body.innerText
  return {
    shown: text.includes('选一道题开始作答'),
    hasCat: text.includes('今日一练') && text.includes('归纳概括'),
    hasBlank: text.includes('空白作答'),
  }
})
ok('答题页·进页自动弹出选题弹窗', modal.shown)
ok('答题页·弹窗有分类条（今日一练+题型）', modal.hasCat)

// 点分类「全部」再选第一题 → 弹窗关、材料载入
const picked = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const all = btns.find((b) => b.textContent.trim() === '全部')
  all?.click()
  return !!all
})
await new Promise((r) => setTimeout(r, 400))
const clicked = await p.evaluate(() => {
  // 弹窗列表条目：块级按钮（w-full text-left），第一条即当前分类下的第一题
  const item = [...document.querySelectorAll('button.w-full.text-left')][0]
  item?.click()
  return !!item
})
await new Promise((r) => setTimeout(r, 2000))
const after = await p.evaluate(() => ({
  modalClosed: !document.body.innerText.includes('选一道题开始作答'),
  materialLoaded: document.body.innerText.includes('给定资料'),
  itemCount: [...document.querySelectorAll('button.w-full.text-left')].length,
}))
ok('选题弹窗·能选中题目并关闭', picked && clicked && after.modalClosed && after.materialLoaded,
  `picked:${picked} clicked:${clicked} closed:${after.modalClosed} material:${after.materialLoaded} items:${after.itemCount}`)

// 页面级不滚动（材料独滚的前提）：滚动容器高度应等于视口内可用高度
const geo = await p.evaluate(() => {
  const doc = document.scrollingElement
  const mat = [...document.querySelectorAll('section')].find((s) => s.innerText.includes('给定资料'))
  const scroller = mat?.querySelector('.overflow-y-auto')
  return {
    pageScrollable: doc.scrollHeight - doc.clientHeight,
    matScrollH: scroller ? scroller.scrollHeight : 0,
    matClientH: scroller ? scroller.clientHeight : 0,
    answerVisible: !!document.body.innerText.match('我的作答'),
    submitVisible: !!document.body.innerText.match('答完了，开始批改'),
  }
})
ok('答题页·整页不滚动（lg）', geo.pageScrollable <= 2, `溢出 ${geo.pageScrollable}px`)
ok('答题页·材料面板独滚', geo.matScrollH > geo.matClientH, `内容 ${geo.matScrollH} > 视口 ${geo.matClientH}`)
ok('答题页·作答区与提交条同屏可见', geo.answerVisible && geo.submitVisible)
await p.screenshot({ path: 'E:/code/bluepencil/.shots/revamp-practice-page.png' })

await b.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
process.exit(failed.length ? 1 : 0)
