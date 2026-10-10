// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// M7 学习周报 · 数据层（纯函数、零依赖、零 LLM）。
//
// 验收铁律（规划文档 M7）：数据不足时明说「样本不够」，不硬编。
// 具体到三条红线：
//   ① 没练的周不编数据 —— 空周明说「还没动笔」；
//   ② 对比要有依据 —— 本周与上周都 ≥ MIN_COMPARE 篇才谈升降，缺一边只报本周事实；
//   ③ 错误类型要高频才算 —— 单类 ≥ MIN_ERROR_COUNT 次才进「下周重点」，
//      一次批注偶然提一句就让人改毛病，是拿个例当规律。
//
// 周的定义：中国习惯，周一为一周之始，本地时区（不走 UTC——差一天最伤人）。

// ⚠️ 写全 .js 后缀：本模块要保持能被 Node 直接 import（.tools/test-weekly.mjs 要跑它）。
import { ERROR_TYPES, normalizeErrorType, errorTypeById } from '../data/error-taxonomy.js'

const DAY_MS = 86400000

/** 对比成立的最小双周样本：每边至少几篇才谈「变化」 */
export const MIN_COMPARE = 3

/** 单个错误类型成为「高频」的最少出现次数 */
export const MIN_ERROR_COUNT = 2

/** 周报结论（评分率对比）需要的本周最少篇数，与能力画像的样本线一致 */
export const MIN_WEEK_SAMPLE = 3

/** 「下周重点」最多列几条 */
export const TOP_ERRORS_LIMIT = 3

/**
 * 给定时刻所在周的周一 00:00（本地时区）。
 * getDay() 周日返回 0 —— 周日要归到**这一周**（还在本周内），所以偏移按 (day+6)%7。
 * @param {Date} now
 */
export function weekStart(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

/** 一周区间 { startTs, endTs }：本周一 00:00 起、下周一 00:00 止（左闭右开） */
export function weekRange(now) {
  const start = weekStart(now)
  return { startTs: start.getTime(), endTs: start.getTime() + 7 * DAY_MS }
}

/** 'M月D日' 短日期 */
function md(ts) {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 单篇得分率（0~100，保留一位）；缺分/缺满分的不算——没依据不开口 */
export function scoreRate(r) {
  const s = Number(r && r.finalScore)
  const m = Number(r && r.maxScore)
  if (!Number.isFinite(s) || !Number.isFinite(m) || m <= 0) return null
  return +((s / m) * 100).toFixed(1)
}

/** 平均得分率；空数组返回 null（不是 0 —— 0 分和没写是两回事） */
export function avgRate(list) {
  const rs = (Array.isArray(list) ? list : [])
    .map(scoreRate)
    .filter((x) => x !== null)
  if (!rs.length) return null
  return +(rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(1)
}

/**
 * 周报主入口。纯派生，不改任何存储。
 *
 * @param {Array} records 批改记录（buildRecord 形态；老记录缺 createdAt 自动跳过）
 * @param {Date} now 基准时刻（默认当前；测试注入固定时刻）
 * @returns 周报对象，字段全部自带依据（basis），UI 只做展示不做判断
 */
export function buildWeeklyReport(records, now = new Date()) {
  const all = Array.isArray(records) ? records : []
  const { startTs, endTs } = weekRange(now)
  const lastStartTs = startTs - 7 * DAY_MS

  const inRange = (r, a, b) => {
    const t = Number(r && r.createdAt)
    return Number.isFinite(t) && t >= a && t < b
  }
  const thisWeek = all.filter((r) => inRange(r, startTs, endTs))
  const lastWeek = all.filter((r) => inRange(r, lastStartTs, startTs))

  const label = `${md(startTs)} – ${md(endTs - DAY_MS)}`

  // ── 空周：没练就是不练，不编安慰话 ──
  if (!thisWeek.length) {
    return {
      label,
      empty: true,
      thisWeek: { count: 0, avgRate: null },
      lastWeek: { count: lastWeek.length, avgRate: avgRate(lastWeek) },
      compare: null,
      topErrors: [],
      advice: '这周还没动笔。周报不编数据——去练一篇，下周再来翻这一页。',
    }
  }

  const thisAvg = avgRate(thisWeek)
  const lastAvg = avgRate(lastWeek)

  // ── 对比：双边都够样本才谈升降（MIN_COMPARE） ──
  let compare = null
  if (thisWeek.length >= MIN_COMPARE && lastWeek.length >= MIN_COMPARE
    && thisAvg !== null && lastAvg !== null) {
    compare = {
      delta: +(thisAvg - lastAvg).toFixed(1),
      thisAvg,
      lastAvg,
      basis: `本周 ${thisWeek.length} 篇 vs 上周 ${lastWeek.length} 篇（每边 ≥${MIN_COMPARE} 篇才比）`,
    }
  }

  // ── 高频错误：本周批注类型聚合。单类 ≥ MIN_ERROR_COUNT 才算高频。
  // 类型统一走 normalizeErrorType（老记录自由文本归一），label 用固定表。 ──
  const typeCount = new Map()
  for (const r of thisWeek) {
    for (const tr of r.results || []) {
      for (const a of tr.annotations || []) {
        const id = normalizeErrorType(a && a.type)
        if (!id || id === 'other') continue // 「其他」给不出可照做的改法，不进重点
        typeCount.set(id, (typeCount.get(id) || 0) + 1)
      }
    }
  }
  const topErrors = [...typeCount.entries()]
    .filter(([, n]) => n >= MIN_ERROR_COUNT)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_ERRORS_LIMIT)
    .map(([id, count]) => ({
      id,
      label: errorTypeById(id).label,
      count,
      selfCheck: errorTypeById(id).selfCheck,
      basis: `本周 ${count} 次批注提到（≥${MIN_ERROR_COUNT} 次才算高频）`,
    }))

  // ── 题型分布：只认 questionType 字段（老记录没有就跳过，不拿标题猜） ──
  const byType = {}
  for (const r of thisWeek) {
    const t = String(r.questionType || '').trim()
    if (t) byType[t] = (byType[t] || 0) + 1
  }

  // ── 近 4 周篇数（旧 → 新，含本周）：迷你趋势条 ──
  const weeks = []
  for (let i = 3; i >= 0; i--) {
    const s = startTs - i * 7 * DAY_MS
    weeks.push({
      label: i === 0 ? '本周' : `${md(s)}`,
      count: all.filter((r) => inRange(r, s, s + 7 * DAY_MS)).length,
      current: i === 0,
    })
  }

  // ── 建议：规则引擎，每条话都挂事实 ──
  let advice
  if (thisWeek.length < MIN_WEEK_SAMPLE) {
    advice = `本周练了 ${thisWeek.length} 篇，样本太少，先不谈趋势和强弱——保持节奏，一周 3 篇起周报才有内容可说。`
  } else if (compare) {
    const d = compare.delta
    const dir = d > 0 ? '高出上周' : d < 0 ? '低于上周' : '与上周持平'
    advice = `本周平均得分率 ${thisAvg}%，${dir}${d !== 0 ? ` ${Math.abs(d)} 个点` : ''}。${
      topErrors.length
        ? `下周重点：${topErrors.map((e) => e.label).join('、')}——动笔前先自查「${topErrors[0].selfCheck}」。`
        : '本周批注里没有重复出现的错误类型，保持。'
    }`
  } else {
    advice = `本周平均得分率 ${thisAvg}%。${
      lastWeek.length
        ? `上周只练了 ${lastWeek.length} 篇，样本不够，不作对比——连续两周都 ≥${MIN_COMPARE} 篇才能看出趋势。`
        : '上周没练，没有比较对象。'
    }${topErrors.length ? ` 下周重点：${topErrors.map((e) => e.label).join('、')}。` : ''}`
  }

  return {
    label,
    empty: false,
    thisWeek: { count: thisWeek.length, avgRate: thisAvg },
    lastWeek: { count: lastWeek.length, avgRate: lastAvg },
    compare,
    topErrors,
    byType,
    weeks,
    advice,
  }
}

/** 错误类型总数（供 UI 空态文案引用口径） */
export const ERROR_TYPE_TOTAL = ERROR_TYPES.length
