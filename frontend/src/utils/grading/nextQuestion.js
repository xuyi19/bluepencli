// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 「再练一题」：按错题本里的短板，从题库里挑下一道题。
//
// 这份东西最容易做错的地方不是算法，是**假装有依据**：
//   错题本按「栽在几份记录里」排序是对的，但那是**跨题型的**统计。
//   如果一个人做「归纳概括」漏点、做「提出对策」也漏点，那「要点遗漏」是通病；
//   可如果他只在「归纳概括」上漏点，推荐他再写一道「归纳概括」才有意义 ——
//   换成「大作文」是在换题型重来，不是在补短板。
//
//   所以这里的判据分成两档，而且 UI 必须把两档分开说：
//     · **定向**：某类问题**集中**在某个题型上（该题型占了一半以上）→ 推同题型。
//       话术是"你在归纳概括上反复漏点，再来一道同类题"。
//     · **泛化**：某类问题**散落在多个题型**上（≥2 个题型都出现）→ 推任意题型。
//       话术是"这是通病，换什么题都该注意"。
//   两个条件都不满足时**不给推荐**，如实说"样本还太少"。
//
// 为什么不做"难度递进"：题库里的 difficulty 是 1~5 的自评，15 道仿真题里同题型只有
// 3 道，按难度排等于随机。**没有依据的排序比不排序更糟** —— 用户会以为它有意义。
//
// 纯函数，不碰 IndexedDB、不碰网络。测试在 .tools/test-next-question.mjs。

import { errorTypeById } from '../../data/error-taxonomy.js'
import { buildReviewCard } from './reviewCard.js'

/** 一款题型要至少出现几次，才敢说"某类问题集中在这个题型上" */
const MIN_SAME_TYPE = 2
/** 泛化的门槛：至少在两个不同题型上都栽过 */
const MIN_SPREAD_TYPES = 2

/**
 * 按题型聚合记录，统计每类问题在各题型上的分布。
 *
 * @param {object[]} records 规范记录（`buildRecord` 产出，需带 `questionType`）
 * @returns {{
 *   types: Array<{type:string, recordCount:number, topIssue:string, topIssueLabel:string}>,
 *   spread: Array<{id:string, label:string, selfCheck:string, types:string[], recordCount:number}>,
 *   total: number, typed: number
 * }}
 */
export function analyzeByQuestionType(records) {
  const list = (records || []).filter(Boolean)
  // 只有带题型的记录能参与定位 —— 老记录（v0.13.3 之前）没有这个字段，
  // 拿标题去猜题型不行：标题里有「概括」两个字不代表它是一道归纳概括题。
  const typed = list.filter((r) => String(r.questionType || '').trim())

  const byType = new Map()   // 题型 → { recordIds:Set, issueCount:Map<id,次数> }
  const issueTypes = new Map() // 问题 id → { types:Set<string>, recordIds:Set }

  for (const rec of typed) {
    const type = String(rec.questionType).trim()
    const card = buildReviewCard(rec, { topN: 0 })
    if (!card.stats.teacherCount) continue

    if (!byType.has(type)) byType.set(type, { recordIds: new Set(), issueCount: new Map() })
    const bucket = byType.get(type)
    bucket.recordIds.add(rec.id)

    for (const c of card.stats.categories) {
      if (c.id === 'other') continue
      bucket.issueCount.set(c.id, (bucket.issueCount.get(c.id) || 0) + c.count)
      if (!issueTypes.has(c.id)) issueTypes.set(c.id, { types: new Set(), recordIds: new Set() })
      issueTypes.get(c.id).types.add(type)
      issueTypes.get(c.id).recordIds.add(rec.id)
    }
  }

  const types = [...byType.entries()]
    .map(([type, b]) => {
      // 这个题型上栽得最狠的那一类：先看被提次数，再看是否多份记录都有
      const sorted = [...b.issueCount.entries()].sort((a, x) => x[1] - a[1])
      const top = sorted[0]
      return {
        type,
        recordCount: b.recordIds.size,
        topIssue: top ? top[0] : '',
        topIssueLabel: top ? errorTypeById(top[0]).label : '',
        issueCount: top ? top[1] : 0,
      }
    })
    .sort((a, b) => b.recordCount - a.recordCount || b.issueCount - a.issueCount)

  const spread = [...issueTypes.entries()]
    .map(([id, e]) => ({
      id,
      label: errorTypeById(id).label,
      selfCheck: errorTypeById(id).selfCheck,
      types: [...e.types],
      recordCount: e.recordIds.size,
    }))
    // 跨的题型越多越像通病；同数量看栽在几份记录里
    .sort((a, b) => b.types.length - a.types.length || b.recordCount - a.recordCount)

  return { types, spread, total: list.length, typed: typed.length }
}

/**
 * 推荐下一题。
 *
 * @param {object[]} records 规范记录
 * @param {object[]} pool    候选题（`data/questions.js` 的 BUILTIN_POOL 或页面自己的池子）
 * @param {object} [opts]
 * @param {string} [opts.excludeId] 刚做完的那道，不再推
 * @returns {{
 *   ok: boolean, reason: string, basis: 'typed'|'spread'|'',
 *   issue: object|null, question: object|null,
 *   candidates: number, needsType: string
 * }}
 */
export function recommendNextQuestion(records, pool, { excludeId = '' } = {}) {
  const questions = (pool || []).filter(Boolean)
  const stats = analyzeByQuestionType(records)
  const empty = {
    ok: false, reason: '', basis: '', issue: null, question: null, candidates: 0, needsType: '',
  }

  if (!stats.typed) {
    return {
      ...empty,
      reason: records?.length
        ? '这些记录是旧版批改留下的，没存题型信息，攒不出"该练哪一类题"的判断。再做几道新题就有了。'
        : '还没有批改记录。先做完一道题，这里才知道该给你推什么。',
    }
  }

  // —— 一档：某类问题**集中**在某个题型上 ——
  // 条件苛刻是有意的：既要"这类问题在这个题型上反复出现"（≥2 份记录），
  // 又要它**占了这个题型的问题的一半以上** —— 否则只能说这个题型问题多，
  // 不能说它有什么特征性的毛病。
  const focused = []
  for (const t of stats.types) {
    if (t.recordCount < MIN_SAME_TYPE) continue
    const top = stats.spread.find((s) => s.id === t.topIssue)
    if (!top) continue
    // 这一类问题在这个题型上很显眼：它跨的题型里，这个题型是"主场"
    const share = top.types.length === 1 ? 1 : 1 / top.types.length
    if (share >= 0.5) focused.push({ type: t.type, issue: top, recordCount: t.recordCount })
  }
  focused.sort((a, b) => b.recordCount - a.recordCount || b.issue.recordCount - a.issue.recordCount)

  if (focused.length) {
    const pick = focused[0]
    const list = questions.filter(
      (q) => String(q.type || '').trim() === pick.type && q.id !== excludeId,
    )
    if (list.length) {
      return {
        ok: true,
        reason: `「${pick.issue.label}」集中在${pick.type}上（${pick.issue.recordCount} 份记录里都栽在这），换同题型的题再练一遍最对症。`,
        basis: 'typed',
        issue: pick.issue,
        question: list[0],
        candidates: list.length,
        needsType: pick.type,
      }
    }
  }

  // —— 二档：某类问题是**跨题型的通病** ——
  // 换什么题型都会栽，那就说明问题不在题型本身（比如"整句照抄"是习惯问题）。
  // 这时推同题型反而误导 —— 用户会以为是题型没掌握。
  const spread = stats.spread.find((s) => s.types.length >= MIN_SPREAD_TYPES && s.recordCount >= MIN_SAME_TYPE)
  if (spread) {
    const list = questions.filter((q) => q.id !== excludeId)
    if (list.length) {
      return {
        ok: true,
        reason: `「${spread.label}」在 ${spread.types.join('、')} 上都出现过，不是某个题型的问题，换道题也要盯着它。`,
        basis: 'spread',
        issue: spread,
        question: list[0],
        candidates: list.length,
        needsType: '',
      }
    }
  }

  return {
    ...empty,
    reason: `目前只有 ${stats.typed} 份带题型的记录，同类问题还没重复到能下结论的程度。再做一道同类题，这里就能看出规律了。`,
  }
}
