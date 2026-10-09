/**
 * M1 学习中心真浏览器探针 —— .tools/probe-home-workbench.mjs
 * 断言用户看得见的结果（卡片文案、徽标、倒计时数字），不断言内部实现。
 * 三条诚实铁律落进断言：
 *   ① 做完的任务不假装没做（注入今天的精读/收藏 → 徽标出现）
 *   ② 没做的任务不假装做完（不注入练习记录 → 练一题卡无 ✓）
 *   ③ 没设目标日期不显示倒计时（新 page 清 localStorage → 显示日期输入框）
 * 顺带钉素材本收藏旁路表：点收藏 → bp-fav-at 写入该键；取消 → 该键消失（按 key 断言，
 * 不按 length——环境里可能有别的旧收藏，数条数会误伤）。
 *
 * 用法：node .tools/probe-home-workbench.mjs [BASE]   （默认 http://127.0.0.1:5281）
 * 场景隔离：每个场景新开 page（evaluateOnNewDocument 是页级注入，新 page 干净）。
 */
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/许/.workbuddy/binaries/node/workspace/node_modules/')
const puppeteer = require('puppeteer-core')

const BASE = process.argv[2] || 'http://127.0.0.1:5281'
let pass = 0, fail = 0
const t = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`) }
}

// 本地日期键（与 workbench.js 同口径：本地时区，不走 UTC）
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const TODAY = dayKey(new Date())
const TODAY_TS = new Date(`${TODAY}T12:00:00`).getTime()
const EXAM_DAY = dayKey(new Date(Date.now() + 7 * 86400000)) // 断言 D-7，注入值必须同口径

const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
})

// 采集工作台可见状态（对两个场景复用）
async function readBench(page) {
  await page.waitForSelector('[data-testid="workbench"]', { timeout: 15000 })
  await new Promise((r) => setTimeout(r, 1200))
  return page.evaluate(() => {
    const txt = (sel) => document.querySelector(sel)?.innerText || ''
    return {
      workbench: !!document.querySelector('[data-testid="workbench"]'),
      countdown: txt('[data-testid="countdown-card"]'),
      streakDots: document.querySelectorAll('[data-testid="streak-dots"] span').length,
      streakNum: txt('[data-testid="streak-card"]'),
      practice: txt('[data-testid="task-practice"]'),
      read: txt('[data-testid="task-read"]'),
      lexicon: txt('[data-testid="task-lexicon"]'),
      profile: txt('[data-testid="profile-glance"]'),
    }
  })
}

// ── 场景一：今天有精读 + 收藏，没练习；考试日期 = 今天 + 7 ──
{
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900 })
  await p.evaluateOnNewDocument((today, todayTs, examDay) => {
    localStorage.clear()
    localStorage.setItem('bp-exam-date', examDay)
    localStorage.setItem('bp-read-result:probe-q-1', JSON.stringify({ rate: 80, at: todayTs + 1000 }))
    localStorage.setItem('bp-fav-at', JSON.stringify({ 'lex-a': todayTs + 2000 }))
  }, TODAY, TODAY_TS, EXAM_DAY)

  await p.goto(`${BASE}/#/`, { waitUntil: 'networkidle2' })
  const w = await readBench(p)

  t('工作台 section 存在', w.workbench)
  t('倒计时卡显示 D-7（注入的是今天+7）', /D-7/.test(w.countdown), w.countdown.slice(0, 40))
  t('打卡点阵 = 14 格', w.streakDots === 14, `got ${w.streakDots}`)
  t('连击 ≥ 1（今天有精读+收藏活动）', /(\d+)/.test(w.streakNum) && parseInt(w.streakNum.match(/(\d+)/)[1], 10) >= 1)
  t('★ 没练习不假装练过：练一题卡无 ✓ 徽标', !w.practice.includes('✓'), w.practice.slice(0, 60))
  t('练一题 CTA 是未完成态文案「开始今日一练」', w.practice.includes('开始今日一练'))
  t('★ 今天精读过 → ✓ 已读 1 则（做完不假装没做）', w.read.includes('✓ 已读 1 则'), w.read.slice(0, 50))
  t('★ 今天收藏过 → ✓ 已收 1 条', w.lexicon.includes('✓ 已收 1 条'), w.lexicon.slice(0, 50))
  t('画像卡诚实空态（无记录 → 提示样本不足）', w.profile.includes('样本') || w.profile.includes('批改'))
  await p.close()
}

// ── 场景二：全新 page（无注入）→ 没设日期不显示倒计时 ──
{
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900 })
  await p.goto(`${BASE}/#/`, { waitUntil: 'networkidle2' })
  await p.evaluate(() => localStorage.clear())
  await p.reload({ waitUntil: 'networkidle2' })
  const w = await readBench(p)
  t('★ 没设日期 → 无 D-N 倒计时数字（不编造）', !/D-\d/.test(w.countdown), w.countdown.slice(0, 40))
  t('没设日期 → 显示日期输入框（date input 在场）',
    !!(await p.$('[data-testid="countdown-card"] input[type="date"]')))
  await p.close()
}

// ── 场景三：素材本收藏联动（toggleFav → bp-fav-at 旁路表）──
{
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900 })
  await p.goto(`${BASE}/#/lexicon`, { waitUntil: 'networkidle2' })
  await p.waitForSelector('.lex-item', { timeout: 15000 })
  await new Promise((r) => setTimeout(r, 600))

  // 点第一个词条的收藏按钮（title 含「收进素材本」）
  const favBtn = await p.$('.lex-item button[title*="收进素材本"]')
  t('素材本有收藏按钮', !!favBtn)
  if (favBtn) {
    // 词条 DOM 没有 data-id 属性 —— 用「点击前后差集」判定新写入的键（不猜 DOM 结构）
    const before = await p.evaluate(() => JSON.parse(localStorage.getItem('bp-fav-at') || '{}'))
    await favBtn.click()
    await new Promise((r) => setTimeout(r, 400))
    const after = await p.evaluate(() => JSON.parse(localStorage.getItem('bp-fav-at') || '{}'))
    const added = Object.keys(after).filter((k) => !(k in before))
    t('★ 点收藏 → bp-fav-at 新增该词条时间戳',
      added.length === 1 && Number.isFinite(after[added[0]]), JSON.stringify(after).slice(0, 80))

    // 取消收藏 → 旁路表该键同步清掉（按 key 断言，不按 length）
    const favBtn2 = await p.$('.lex-item button[title*="取消收藏"]')
    if (favBtn2) {
      await favBtn2.click()
      await new Promise((r) => setTimeout(r, 400))
      const removed = await p.evaluate(() => JSON.parse(localStorage.getItem('bp-fav-at') || '{}'))
      t('★ 取消收藏 → 旁路表该键消失', added.length === 1 && !(added[0] in removed),
        JSON.stringify(removed).slice(0, 80))
    }
  }
  await p.evaluate(() => localStorage.clear()).catch(() => {})
  await p.close()
}

await b.close()
console.log(`\n首页工作台探针：${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
