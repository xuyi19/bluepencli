// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 对标差距报告（M16）·「写完 ≠ 练完」
//
// 用户练完一道题最真实的下一句疑问是：「我和满分答案差在哪？」
// 批注/升格回答的是「怎么改」，本模块回答的是「差在哪」：
//   1. 逐点对齐 —— 每个采分点：写到（引用户原句）/ 沾边 / 漏了（给标准表述），
//      答反方向（forbidden）单独标红——这是最伤分的一类；
//   2. 冗余分析 —— 作答里与**任何**采分点都不沾边的句子列为「疑似冗余」，
//      申论提分的第一课是「删」：小题踩点给分，写没用的字不仅不加分还稀释要点；
//   3. verdict —— 纯代码生成的一两句总结，零 LLM 成本。
//
// 复用 agents/grading/standard.js 的 matchPoint 定每点总状态（判据同族：
// evidence ≥8 字 / keywords / synonyms / forbidden 最先判），但 matchPoint
// 不告诉我「我写的**哪句话**命中」——对标报告要引用户原句才直观，
// 所以分句后逐句再判一遍取首条命中句。两句判据刻意保持一致，
// 避免出现「总状态说 HIT、逐句却找不到命中句」的自相矛盾。
//
// 刻意不做的：
//   · 模糊相似度 / 语义向量 —— 差距判断必须能向用户解释「为什么算你漏了」；
//   · 把冗余判成扣分 —— 冗余只是「白写的字」，公文格式语（称谓/落款）会误入，
//     UI 一律写「疑似冗余，仅供参考」，方向是提醒不是裁决；
//   · 大作文（essay）—— 文章没有采分点，standard.points 为空时本模块返回 null。
//
// 本模块零依赖、纯函数，可被 Node 直接 import（护栏：.tools/test-gap.mjs）。

import { matchPoint, POINT_STATUS } from '../../agents/grading/standard.js'

/** 归一化：去空白，保留标点（与 matchPoint.flat 同口径） */
function norm(s) {
  return String(s || '').replace(/\s+/g, '')
}

/**
 * 作答分句。按句终标点 + 换行切，保留标点在句尾；
 * 归一化后不足 4 字的残句（单个标点、连接词）丢弃——没有对标意义。
 * @returns {Array<{ text: string }>} text 保留原文（含标点），展示与匹配都用它
 */
export function splitSentences(answer) {
  const raw = String(answer || '').split(/(?<=[。！？；!?;\n])/)
  const out = []
  for (const piece of raw) {
    const t = piece.trim()
    if (norm(t).length >= 4) out.push({ text: t })
  }
  return out
}

/**
 * 单句 × 单点：这句是否「沾到」该点。
 * 判据与 matchPoint 同族但按句收紧：片段/关键词/同义词任一出现在句中即算沾到。
 * @returns {{ via: 'evidence'|'keyword'|'synonym', token: string } | null}
 */
export function sentenceHit(sentence, point) {
  const s = norm(sentence)
  if (!s) return null
  for (const ev of point?.evidence || []) {
    const e = norm(ev)
    if (e.length >= 8 && s.includes(e)) return { via: 'evidence', token: ev }
  }
  for (const k of point?.keywords || []) {
    const n = norm(k)
    if (n.length >= 2 && s.includes(n)) return { via: 'keyword', token: k }
  }
  for (const syn of point?.synonyms || []) {
    const n = norm(syn)
    if (n.length >= 2 && s.includes(n)) return { via: 'synonym', token: syn }
  }
  return null
}

/**
 * 主入口：标准 × 作答 → 对标差距报告。
 * @param {object} standard getStandard(questionId) 的结果（points 必须有）
 * @param {string} answer   用户作答全文
 * @returns {null | {
 *   rows: [{ id, label, weight, status: 'hit'|'partial'|'miss', forbidden,
 *            myQuote: string|null, via: string|null,
 *            standardHint: string, evidenceHint: string|null }],
 *   redundancy: { sentences: string[], rate: number, kept: number, redundant: number },
 *   stats: { totalPoints, hitCount, partialCount, missCount, forbiddenCount,
 *            coverage, redundantRate, answerChars },
 *   verdicts: string[]
 * }}
 * 无采分点标准（大作文/无私有标准）返回 null，调用方不渲染。
 */
export function buildGapReport(standard, answer) {
  const points = standard?.points || []
  const text = String(answer || '')
  if (!points.length || norm(text).length < 10) return null

  const sentences = splitSentences(text)
  // 每句先判「被哪个点沾到」——被任意点沾到的句子不算冗余
  const sentenceCovers = sentences.map((sn) =>
    points.some((p) => sentenceHit(sn.text, p) !== null)
  )

  const rows = points.map((p) => {
    const m = matchPoint(p, text)
    const status = m.status === POINT_STATUS.HIT
      ? 'hit'
      : m.status === POINT_STATUS.PARTIAL ? 'partial' : 'miss'
    // 首条命中句 → 引用户原句；总状态可能由分散关键词拼出 HIT，
    // 逐句找不到时 myQuote 留 null（UI 显示「命中但表述分散」，不硬凑）
    let myQuote = null
    let via = null
    for (const sn of sentences) {
      const h = sentenceHit(sn.text, p)
      if (h) { myQuote = sn.text; via = h.via; break }
    }
    return {
      id: p.id,
      label: p.label || p.text || '(未命名要点)',
      weight: Number(p.weight) || 0,
      status,
      forbidden: !!m.forbidden,
      myQuote,
      via,
      standardHint: p.label || '',
      evidenceHint: (p.evidence || [])[0] || null,
    }
  })

  const redundantSentences = sentences
    .filter((_, i) => !sentenceCovers[i])
    .map((sn) => sn.text)
  const totalChars = norm(text).length
  const redundantChars = redundantSentences.reduce((s, t) => s + norm(t).length, 0)
  const redundantRate = totalChars > 0
    ? Math.round((redundantChars / totalChars) * 100) : 0

  const hitCount = rows.filter((r) => r.status === 'hit').length
  const partialCount = rows.filter((r) => r.status === 'partial').length
  const missCount = rows.filter((r) => r.status === 'miss' && !r.forbidden).length
  const forbiddenCount = rows.filter((r) => r.forbidden).length
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0) || 1
  const earned = rows.reduce(
    (s, r) => s + r.weight * (r.forbidden ? 0 : r.status === 'hit' ? 1 : r.status === 'partial' ? 0.5 : 0),
    0
  )
  const coverage = Math.round((earned / totalWeight) * 100)

  // verdict：纯代码、按严重度排序，最多两条 —— 有依据才说话
  const verdicts = []
  if (forbiddenCount > 0) {
    verdicts.push(`有 ${forbiddenCount} 处答反了方向——方向错，写得再多也是 0 分，先看「反向要点」`)
  }
  if (missCount > 0) {
    verdicts.push(`漏了 ${missCount} 个要点（红标处），带着「漏点清单」回材料重读一遍`)
  }
  if (redundantRate >= 45) {
    verdicts.push(`约 ${redundantRate}% 的篇幅与采分点无关——小题踩点给分，先学「删」再学「写」`)
  }
  if (!verdicts.length && hitCount === points.length) {
    verdicts.push('要点全中——下一步练表述：对照标准要点，把口语说法换成规范词')
  }
  if (!verdicts.length) {
    verdicts.push(`要点覆盖 ${coverage}%，重点看沾边（◐）的半分点，补全即提分`)
  }

  return {
    rows,
    redundancy: {
      sentences: redundantSentences,
      rate: redundantRate,
      kept: sentences.length - redundantSentences.length,
      redundant: redundantSentences.length,
    },
    stats: {
      totalPoints: points.length,
      hitCount,
      partialCount,
      missCount,
      forbiddenCount,
      coverage,
      redundantRate,
      answerChars: totalChars,
    },
    verdicts,
  }
}
