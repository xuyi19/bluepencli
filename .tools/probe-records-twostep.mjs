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
// 造一条最小记录进 IndexedDB（bluepencil / records），详情链路才有东西可点
await page.goto(`${BASE}/#/other`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await page.evaluate(async () => {
  await new Promise((resolve, reject) => {
    // 与应用 db.js 同构：open(DB, 3)，onupgradeneeded 建缺失的 store（探针库可能是空 v1）
    const req = indexedDB.open('bluepencil', 3)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('records', 'readwrite')
      tx.objectStore('records').put({
        id: 'probe-rec-1', createdAt: Date.now(), title: '探针题：结合给定资料谈基层治理',
        questionId: '', examPaperId: '', examPaperTitle: '', examPaperNo: null,
        questionType: '概括', requirement: '观点明确，条理清楚。', material: '给定资料一：基层治理存在短板。',
        answer: '基层治理要坚持问题导向。\n同时压实各级责任。',
        wordLimit: null, wordCount: 20, maxScore: 20, mode: 'solo', teacherIds: [],
        teachers: [], finalScore: 12, level: '中等', source: 'local',
        results: [{ teacherId: 'xiewen', score: 12, maxScore: 20, advice: '继续巩固', annotations: [] }],
      })
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  }).catch(e => console.log('[inject skip]', String(e)))
})
// ── 列表 → 详情 → 返回 ──
await page.goto(`${BASE}/#/records`, { waitUntil: 'networkidle2' })
await new Promise(r => setTimeout(r, 1800))
let s = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('.grid > div')].filter((d) => d.className.includes('neu-sm')).length,
  title: document.body.innerText.includes('探针题'),
}))
check('列表：探针记录卡片出现', s.cards > 0 && s.title, `cards=${s.cards}`)
await page.evaluate(() => { [...document.querySelectorAll('.grid > div')].find((d) => d.className.includes('neu-sm'))?.click() })
await new Promise(r => setTimeout(r, 1200))
s = await page.evaluate(() => ({
  back: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('返回列表')),
  downloads: [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('下载')).length,
  textW: (() => {
    const p = document.querySelector('.max-w-4xl .whitespace-pre-wrap')
    return p ? p.getBoundingClientRect().width : 0
  })(),
}))
check('详情：返回列表按钮', s.back)
check('详情：下载 Word/PDF', s.downloads >= 2)
check('详情：长文本宽度 >500px（竖排已修）', s.textW > 500, `w=${Math.round(s.textW)}`)
await page.screenshot({ path: 'E:/code/bluepencil/.shots/records-detail.png' })
await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.includes('返回列表'))?.click() })
await new Promise(r => setTimeout(r, 600))
s = await page.evaluate(() => !!document.querySelector('input[placeholder="搜索题目"]'))
check('返回列表正常', s)
await page.screenshot({ path: 'E:/code/bluepencil/.shots/records-list.png' })
await browser.close()
console.log(`\n两段式探针：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
