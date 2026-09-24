// 「批改时才选老师」弹窗的真实渲染验证。
//   node .tools/probe-teacher-picker.mjs [截图路径]
//
// 为什么要真跑：把选人卡挪进弹窗后，"弹窗弹不出来 / 弹出来但点了没反应"
// 都是**页面照常渲染**的失败——源码级护栏只能盯住接线，盯不住"用户真的看得到"。
// 这里用真 Chrome 走一遍：填作答 → 点「答完了」→ 弹窗出现 → 确认 → 进入批改中。
//
// 依赖：frontend 已起 dev server（127.0.0.1:5273）。

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const WS = 'C:/Users/许/.workbuddy/binaries/node/workspace/node_modules/'
const puppeteer = createRequire(WS)('puppeteer-core')

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p))

const BASE = 'http://127.0.0.1:5273'
const OUT = process.argv[2] || 'E:/code/bluepencil/.shots/teacher-picker.png'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`)
  if (!ok) failed++
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,1000'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 1000 })

// 蓝笔是 hash 路由：必须 /#/practice（写 /practice 会被兜回首页，页面正常但没题=假象）
await page.goto(`${BASE}/#/practice`, { waitUntil: 'networkidle2' })
await page.evaluate(() => {
  localStorage.setItem(
    'llm_config',
    JSON.stringify({ api_key: 'sk-mock', base_url: 'http://127.0.0.1:9731/v1', model: 'mock-model' })
  )
})
await page.reload({ waitUntil: 'networkidle2' })
await sleep(2500)

// 填作答（Vue v-model 要走原生 setter + input 事件）
const filled = await page.evaluate(() => {
  const ta = document.querySelector('textarea.grid-paper')
  if (!ta) return false
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
    ta,
    '这里是一段用于验证弹窗链路的作答内容，字数需要超过二十字才能满足提交条件，因此多写一些。'
  )
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})
check('作答框已填入', filled)
await sleep(600)

const btnText = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('答完了'))
  return b ? { text: b.textContent.trim(), disabled: b.disabled } : null
})
check('底部「开始批改」按钮存在且可点（不能因"没选老师"禁用）', !!btnText && !btnText.disabled,
  btnText ? `文案「${btnText.text}」` : '没找到按钮')

await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((x) => x.textContent.includes('答完了'))?.click()
})
await sleep(700)

const picker = await page.evaluate(() => {
  const t = document.body.innerText
  const confirm = [...document.querySelectorAll('button')].find((b) => /^开始批改（/.test(b.textContent.trim()))
  return {
    shown: t.includes('谁来批改这份作答'),
    teachers: ['袁东', '周泰然', '白鹭'].filter((n) => t.includes(n)),
    confirm: confirm ? confirm.textContent.trim() : null,
    confirmDisabled: confirm ? confirm.disabled : null,
  }
})
check('弹窗已弹出', picker.shown)
check('弹窗里能选到老师', picker.teachers.length >= 3, picker.teachers.join('/'))
check('确认按钮显示人数且不禁用', !!picker.confirm && picker.confirmDisabled === false, picker.confirm || '')

await page.screenshot({ path: OUT })
console.log(`  截图：${OUT}`)

// 确认后要真的发起批改（进入"批改中"，而不是停在原页面）
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => /^开始批改（/.test(b.textContent.trim()))?.click()
})
await sleep(3000)
const started = await page.evaluate(() => {
  const t = document.body.innerText
  return t.includes('批改中') || t.includes('独立阅卷') || t.includes('阅卷')
})
check('确认后真的发起了批改（不是点了没反应）', started)

await browser.close()
console.log(failed ? `\n❌ ${failed} 项未通过` : '\n✅ 弹窗链路全部通过')
process.exit(failed ? 1 : 0)
