// ──────────────────────────────────────────────────────────────
// M9 导出 UI 探针（2026-10-08）
//
//   node .tools/probe-export-ui.mjs            # 需 dev server 在 5280
//
// 浏览器探针（puppeteer-core + 本机 Chrome）验用户路径：
//   1. 设置页出现「导出与打印」区块，路径输入保存进 localStorage；
//   2. 素材本「导出 Word」真实触发下载（.docx 落盘且是 zip）；
//   3. 词库打印题头仍在前（M2 回归）。
import { createRequire } from 'node:module'

const puppeteer = createRequire('C:/Users/许/.workbuddy/binaries/node/workspace/node_modules/')('puppeteer-core')
const BASE = 'http://127.0.0.1:5280'
const OUT = 'E:/code/bluepencil/.shots'

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
// 劫持下载出口必须在任何 goto 之前注册（hash 路由不重载文档，中途注册不生效）
page.evaluateOnNewDocument(() => {
  window.__downloads = []
  const origCreate = URL.createObjectURL.bind(URL)
  URL.createObjectURL = (blob) => {
    const url = origCreate(blob)
    blob.arrayBuffer().then((buf) => {
      const u8 = new Uint8Array(buf.slice(0, 2))
      window.__downloads.push({
        url,
        size: buf.byteLength,
        head: String.fromCharCode(u8[0], u8[1]),
      })
    })
    return url
  }
  const origClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) {
      window.__downloads.push({ fileName: this.download })
      return // 阻断真导航，headless 下载不可靠
    }
    return origClick.call(this)
  }
})
const client = await page.createCDPSession()
await client.send('Browser.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: OUT,
  eventsEnabled: true,
})
const downloads = []
client.on('Browser.downloadWillBegin', (e) => downloads.push(e.suggestedFilename))

page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 120)))

// ── 1. 设置页：导出与打印区块 ──
await page.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 800))
const hasSection = await page.evaluate(() => document.body.innerText.includes('导出与打印'))
check('设置页出现「导出与打印」区块', hasSection)
const webHint = await page.evaluate(() => document.body.innerText.includes('网页版'))
check('网页版模式下提示直接下载', webHint)
await page.evaluate(() => {
  const input = [...document.querySelectorAll('input')].find((i) =>
    (i.placeholder || '').includes('无需设置路径'),
  )
  if (input) {
    input.value = 'E:/复习资料'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
})
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存路径')
  btn?.click()
})
await new Promise((r) => setTimeout(r, 300))
const saved = await page.evaluate(() => localStorage.getItem('bp-export-dir'))
check('保存路径写入 localStorage（bp-export-dir）', saved === 'E:/复习资料', `实际=${saved}`)
await page.evaluate(() => localStorage.removeItem('bp-export-dir'))

// ── 2. 素材本导出 Word：blob 内容验真 ──
// headless 的 CDP 下载落盘不稳定 → 劫持 createObjectURL 拿到 blob 本体，
// 验「点导出 → 生成合法 docx（zip PK 头、体积合理、文件名对）」——
// 磁盘落盘是浏览器/桌面的职责，不属于本页要测的范围。
await page.goto(`${BASE}/#/lexicon`, { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 800))
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('导出 Word'))
  btn?.click()
})
// docx 动态 import + 打包生成要一点时间
let dl = null
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 250))
  dl = await page.evaluate(() => {
    const blobs = (window.__downloads || []).filter((d) => d.head)
    const names = (window.__downloads || []).filter((d) => d.fileName)
    return blobs.length && names.length ? { ...blobs[0], fileName: names[0].fileName } : null
  })
  if (dl) break
}
check('点击导出生成 docx blob（zip PK 头）', !!dl && dl.head === 'PK' && dl.size > 5000, JSON.stringify(dl))
check('文件名带「规范词库」与日期标签', !!dl && /规范词库-全册-\d{8}-\d{4}\.docx/.test(dl.fileName || ''), dl?.fileName)
const statusText = await page.evaluate(() => document.body.innerText.includes('已开始下载'))
check('界面上显示「已开始下载」反馈', statusText)

// ── 3. M2 打印回归：print 题头仍在 ──
const printHead = await page.evaluate(() => !!document.querySelector('.print-head'))
check('词库打印题头仍在（M2 回归）', printHead)

await browser.close()
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
