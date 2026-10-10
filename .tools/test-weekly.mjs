// ──────────────────────────────────────────────────────────────
// M7 学习周报 · 数据层护栏（Node 直跑，零依赖）
// 用法：node .tools/test-weekly.mjs
// 验收铁律（规划 M7）：数据不足时明说「样本不够」，不硬编。
// 每条红线都有对应断言：空周不编数据 / 对比需双边 ≥3 篇 / 高频错误 ≥2 次。
// ──────────────────────────────────────────────────────────────
import { strict as assert } from 'node:assert'
import {
  weekStart, weekRange, scoreRate, avgRate, buildWeeklyReport,
  MIN_COMPARE, MIN_ERROR_COUNT, MIN_WEEK_SAMPLE, TOP_ERRORS_LIMIT,
} from '../frontend/src/utils/weekly.js'

let pass = 0
const cases = []
function t(name, fn) { cases.push([name, fn]) }

// ── 固定基准：2026-10-07 是周三，所在周从周一 10-05 开始 ──
const NOW = new Date(2026, 9, 7, 12, 0, 0)
const MON = weekStart(NOW).getTime()          // 本周一 00:00 = 10-05
const DAY = 86400000

/** 造记录：createdAt = 周一 + dayOffset 天 + 1h；types 是批注类型（可为自由文本） */
function rec(dayOffset, score = 30, max = 100, types = [], qtype = '') {
  return {
    createdAt: MON + dayOffset * DAY + 3600000,
    finalScore: score,
    maxScore: max,
    questionType: qtype,
    results: [{ teacherId: 'x', annotations: types.map((tp) => ({ type: tp, comment: 'c' })) }],
  }
}

// ── 周起点语义 ──
t('weekStart：周三 10-07 所在周从周一 10-05 起', () => {
  const s = weekStart(new Date(2026, 9, 7))
  assert.equal(s.getDay(), 1)
  assert.equal(s.getDate(), 5)
})
t('weekStart：周日归本周（不跳到下周一）', () => {
  const s = weekStart(new Date(2026, 9, 11)) // 10-11 周日
  assert.equal(s.getDay(), 1)
  assert.equal(s.getDate(), 5)
})
t('weekStart：周一零点整（含小时清零）', () => {
  const s = weekStart(new Date(2026, 9, 5, 23, 59, 59))
  assert.equal(s.getHours(), 0)
  assert.equal(s.getMinutes(), 0)
})
t('weekRange：本周一 00:00 起、下周 - 1ms 止（左闭右开 7 天）', () => {
  const r = weekRange(NOW)
  assert.equal(r.startTs, MON)
  assert.equal(r.endTs, MON + 7 * DAY)
})

// ── 得分率 ──
t('scoreRate：30/40 = 75', () => assert.equal(scoreRate({ finalScore: 30, maxScore: 40 }), 75))
t('scoreRate：缺分/满分非法返回 null（不是 0）', () => {
  assert.equal(scoreRate({}), null)
  assert.equal(scoreRate({ finalScore: 20, maxScore: 0 }), null)
  assert.equal(scoreRate(null), null)
})
t('avgRate：空数组返回 null，不是 0', () => assert.equal(avgRate([]), null))
t('avgRate：混合无效记录只算有效的', () => {
  assert.equal(avgRate([{ finalScore: 30, maxScore: 40 }, { finalScore: 1, maxScore: 0 }]), 75)
})

// ── 空周：没练就是不练 ──
t('空周：empty=true，advice 明说没动笔，不编数据', () => {
  const r = buildWeeklyReport([], NOW)
  assert.equal(r.empty, true)
  assert.equal(r.thisWeek.count, 0)
  assert.equal(r.thisWeek.avgRate, null)
  assert.equal(r.compare, null)
  assert.ok(/还没动笔/.test(r.advice), r.advice)
})
t('空周：上周数据仍如实呈现（有就报）', () => {
  const r = buildWeeklyReport([rec(-3, 20), rec(-4, 30)], NOW)
  assert.equal(r.empty, true)
  assert.equal(r.lastWeek.count, 2)   // -8/-9 天都落上周（≥7 天前）
})
t('createdAt 缺失的老记录被跳过，不误判', () => {
  const r = buildWeeklyReport([{ finalScore: 30, maxScore: 40 }, rec(1)], NOW)
  assert.equal(r.empty, false)
  assert.equal(r.thisWeek.count, 1)
})

// ── 对比红线：双边都 ≥ MIN_COMPARE 才谈升降 ──
t(`样本不足（本周 ${MIN_COMPARE - 1} 篇）：不给对比结论，advice 明说样本少`, () => {
  const r = buildWeeklyReport([rec(0), rec(1)], NOW)
  assert.equal(r.empty, false)
  assert.equal(r.compare, null)
  assert.ok(/样本太少/.test(r.advice), r.advice)
})
t('本周够 3 篇、上周 0 篇：不对比，只报本周 + 说明没有比较对象', () => {
  const r = buildWeeklyReport([rec(0), rec(1), rec(2)], NOW)
  assert.equal(r.compare, null)
  assert.ok(/上周没练/.test(r.advice), r.advice)
})
t(`双边都 ≥ ${MIN_COMPARE} 篇：compare 给出 delta 与 basis`, () => {
  const rs = [
    rec(0, 50), rec(1, 70), rec(2, 75),              // 本周：均值 65%
    rec(-3, 40), rec(-4, 45), rec(-5, 50),          // 上周：均值 45%
  ]
  const r = buildWeeklyReport(rs, NOW)
  assert.ok(r.compare, 'compare 应存在')
  assert.equal(r.compare.delta, 20)
  assert.ok(/本周 3 篇 vs 上周 3 篇/.test(r.compare.basis), r.compare.basis)
  assert.ok(/高出上周/.test(r.advice), r.advice)
})
t('下降同样如实报（低于上周），不粉饰', () => {
  const rs = [rec(0, 40), rec(1, 45), rec(2, 50), rec(-3, 50), rec(-4, 70), rec(-5, 75)]
  const r = buildWeeklyReport(rs, NOW)
  assert.equal(r.compare.delta, -20)
  assert.ok(/低于上周/.test(r.advice), r.advice)
})

// ── 高频错误红线：单类 ≥ MIN_ERROR_COUNT 才进重点 ──
t(`同类型批注 ≥ ${MIN_ERROR_COUNT} 次进 topErrors，带 selfCheck 与依据`, () => {
  const rs = [rec(0, 50, 40, ['point-missing']), rec(1, 70, 40, ['point-missing']), rec(2)]
  const r = buildWeeklyReport(rs, NOW)
  assert.equal(r.topErrors.length, 1)
  assert.equal(r.topErrors[0].id, 'point-missing')
  assert.equal(r.topErrors[0].label, '要点遗漏')
  assert.equal(r.topErrors[0].count, 2)
  assert.ok(r.topErrors[0].selfCheck.length > 0, 'selfCheck 必须是可照做的动作')
  assert.ok(new RegExp(String(MIN_ERROR_COUNT)).test(r.topErrors[0].basis), r.topErrors[0].basis)
})
t(`只出现 1 次的类型不进重点（≥${MIN_ERROR_COUNT} 才算高频）`, () => {
  const rs = [rec(0, 50, 40, ['point-missing']), rec(1, 70, 40, ['copy-raw']), rec(2)]
  const r = buildWeeklyReport(rs, NOW)
  assert.equal(r.topErrors.length, 0)
})
t('「其他问题」类型不进下周重点（给不出可照做的改法）', () => {
  const rs = [rec(0, 50, 40, ['other', 'other']), rec(1), rec(2)]
  const r = buildWeeklyReport(rs, NOW)
  assert.equal(r.topErrors.length, 0)
})
t('自由文本批注类型归一到固定口径（层次不清→structure）', () => {
  const rs = [rec(0, 50, 40, ['层次不清']), rec(1, 70, 40, ['层次不清']), rec(2)]
  const r = buildWeeklyReport(rs, NOW)
  assert.equal(r.topErrors[0].id, 'structure')
  assert.equal(r.topErrors[0].label, '结构失当')
})
t('topErrors 最多 3 条（TOP_ERRORS_LIMIT）', () => {
  const types = ['point-missing', 'point-missing', 'copy-raw', 'copy-raw', 'structure', 'structure', 'off-question', 'off-question']
  const rs = [rec(0, 50, 40, types), rec(1), rec(2)]
  const r = buildWeeklyReport(rs, NOW)
  assert.ok(r.topErrors.length <= TOP_ERRORS_LIMIT)
})
t('批注来自 results[].annotations（多老师结果都聚合）', () => {
  const r0 = rec(0, 50, 40, [])
  r0.results = [
    { teacherId: 'a', annotations: [{ type: 'point-missing' }] },
    { teacherId: 'b', annotations: [{ type: 'point-missing' }] },
  ]
  const r = buildWeeklyReport([r0, rec(1), rec(2)], NOW)
  assert.equal(r.topErrors[0].count, 2)
})

// ── 题型分布：只认 questionType 字段 ──
t('byType 按 questionType 聚合；空题型跳过不猜', () => {
  const a = rec(0, 50, 40, [], '归纳概括')
  const b = rec(1, 70, 40, [], '归纳概括')
  const c = rec(2, 75, 40, [], '')          // 空题型跳过
  const r = buildWeeklyReport([a, b, c], NOW)
  assert.deepEqual(r.byType, { 归纳概括: 2 })
})

// ── 近 4 周迷你趋势 ──
t('weeks：4 格（旧→新），最后一格是本周且带 current 标记', () => {
  const rs = [rec(0), rec(-8), rec(-15), rec(-22)]
  const r = buildWeeklyReport(rs, NOW)
  assert.equal(r.weeks.length, 4)
  assert.equal(r.weeks[3].current, true)
  assert.equal(r.weeks[3].count, 1)
  assert.equal(r.weeks[0].count, 1)
  assert.equal(r.weeks[1].count, 1)
})

// ── label 人类可读 ──
t('label：本周一 – 本周日 形式', () => {
  const r = buildWeeklyReport([rec(0)], NOW)
  assert.equal(r.label, '10月5日 – 10月11日')
})

// ── 常量被测试钉住：改口径必须同时改这里（防止静默漂移）──
t('口径常量：MIN_COMPARE=3 / MIN_ERROR_COUNT=2 / MIN_WEEK_SAMPLE=3 / TOP_ERRORS_LIMIT=3', () => {
  assert.equal(MIN_COMPARE, 3)
  assert.equal(MIN_ERROR_COUNT, 2)
  assert.equal(MIN_WEEK_SAMPLE, 3)
  assert.equal(TOP_ERRORS_LIMIT, 3)
})

// ── 跑 ──
for (const [name, fn] of cases) {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1 }
}
console.log(`\n${pass}/${cases.length} 项全绿`)
if (process.exitCode) process.exit(1)
