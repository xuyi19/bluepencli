// ──────────────────────────────────────────────────────────────
// 设置页改版探针（2026-10-08）
//
//   node .tools/probe-settings-ui.mjs [BASE]   # 默认 http://127.0.0.1:5281
//
// 验用户路径：
//   1. 未配置 Key 时进设置页 → API 配置弹窗自动弹出（含服务商预设/保存并关闭）；
//   2. 点「保存并关闭」→ 弹窗关闭、配置写入 localStorage；
//   3. 「导出与打印」是第一个内容区块（在「使用说明」「数据」「关于」之前）；
//   4. 已配置后再进页不自动弹窗；点状态卡可再次打开；
//   5. 弹窗内「测试连接」入口存在（ready 才可点）。
import { createRequire } from 'node:module'

const puppeteer = createRequire('C:/Users/许/.workbuddy/binaries/node/workspace/node_modules/')('puppeteer-core')
const BASE = process.argv[2] || 'http://127.0.0.1:5281'

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`)
  }
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 1280, height: 900 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 120)))

// 探针 localStorage 注入会残留（WebView2/Chrome 持久），开头收尾都要清
await page.evaluateOnNewDocument(() => {
  localStorage.removeItem('llm_config')
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 1. 未配置 → 自动弹窗 ──
await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle2' })
await sleep(1200)

let s = await page.evaluate(() => {
  const modal = [...document.querySelectorAll('div')].find(
    (d) => d.className?.includes?.('fixed inset-0') && d.innerText.includes('API 配置'),
  )
  return {
    modalOpen: !!modal,
    hasPreset: document.body.innerText.includes('服务商预设'),
    hasSaveClose: !!([...document.querySelectorAll('button')].find((b) => b.textContent.includes('保存并关闭'))),
    hasExportFirst: document.body.innerText.indexOf('导出与打印') > -1,
  }
})
check('未配置时进设置页自动弹出 API 配置窗口', s.modalOpen)
check('弹窗含服务商预设', s.hasPreset)
check('弹窗有「保存并关闭」按钮', s.hasSaveClose)
check('设置页含「导出与打印」区块', s.hasExportFirst)

// ── 2. 保存并关闭 → 弹窗关闭 + 配置落盘 ──
await page.evaluate(() => {
  const inp = document.querySelector('input[placeholder="sk-..."]')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(inp, 'sk-test-demo')
  inp.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('保存并关闭'))?.click()
})
await sleep(400)
s = await page.evaluate(() => ({
  modalOpen: !![...document.querySelectorAll('div')].find(
    (d) => d.className?.includes?.('fixed inset-0') && d.innerText.includes('API 配置'),
  ),
  saved: (localStorage.getItem('llm_config') || '').includes('sk-test-demo'),
}))
check('点「保存并关闭」后弹窗关闭', !s.modalOpen)
check('Key 已写入 localStorage', s.saved)

// ── 3. 区块顺序：导出与打印在最前（只看设置页主容器，别算上侧栏导航的「关于」分组） ──
s = await page.evaluate(() => {
  const root = document.querySelector('div.w-full.max-w-5xl')
  const t = root ? root.innerText : document.body.innerText
  const iExport = t.indexOf('导出与打印')
  const iSteps = t.indexOf('使用说明')
  const iData = t.indexOf('清空所有数据')
  const iAbout = t.indexOf('蓝笔申论 · 公考申论 AI 批改工具')
  return { iExport, iSteps, iData, iAbout }
})
check('「导出与打印」排在「使用说明」之前', s.iExport > -1 && s.iExport < s.iSteps, `export=${s.iExport} steps=${s.iSteps}`)
check('「导出与打印」排在数据操作之前', s.iExport < s.iData)
check('「导出与打印」排在「关于」之前', s.iExport < s.iAbout)

// ── 4. 已配置后再进页不自动弹；点状态卡可再开 ──
await page.goto(`${BASE}/#/other`, { waitUntil: 'networkidle2' }).catch(() => {})
await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle2' })
await sleep(1000)
s = await page.evaluate(() => ({
  modalOpen: !![...document.querySelectorAll('div')].find(
    (d) => d.className?.includes?.('fixed inset-0') && d.innerText.includes('API 配置'),
  ),
  hasReady: document.body.innerText.includes('API 已就绪'),
}))
check('已配置后重进设置页不自动弹窗', !s.modalOpen)
check('状态卡显示「API 已就绪」', s.hasReady)

await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('修改配置'))?.click()
})
await sleep(300)
s = await page.evaluate(
  () => !![...document.querySelectorAll('div')].find(
    (d) => d.className?.includes?.('fixed inset-0') && d.innerText.includes('API 配置'),
  ),
)
check('点状态卡「修改配置」可再次打开弹窗', s)

// 收尾清探针残留
await page.evaluate(() => {
  localStorage.removeItem('llm_config')
})

await browser.close()
console.log(`\n设置页探针：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
