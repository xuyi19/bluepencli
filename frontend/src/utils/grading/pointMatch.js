// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// M4 材料精读训练 · 找点匹配器
//
// 用户在材料上划出「要点句」（marks = 荧光锚点 { text, nth }），
// 提交后与该题采分点标准（points[].evidence = 材料原文片段）对照，
// 判定每个采分点是否被找到、每处标注是否有效。
//
// 判定分级（2026-10-10 从二值改成三级 —— 依据：二值判定两头都不准：
//   划个关键词就算全中 = 太松；划了证据里过半的核心短语却不在
//   关键词表 = 漏判。真实阅卷对"找对地方但没找全"也是部分给分）：
//   full（全分）
//     1. 标注 ⊇ 证据（整条证据都在标注里）
//     2. 证据 ⊇ 标注 且覆盖 ≥ 50%
//   partial（半分）
//     3. 证据 ⊇ 标注 且覆盖 ≥ 25%（连续片段，找对地方但没找全）
//     4. 覆盖 < 25%，但标注含该点关键词（且标注必须在证据片段内）
//   都不满足 → miss。
//
// 刻意**不做**的：
//   · 关键词全材料扫描 —— 关键词（如"电商"）会在无关段落反复出现，
//     没碰到证据位置也判命中 = 把"划错地方"洗成"找对了"，训练就失去意义；
//   · synonyms —— 它是给**作答文字**用的等价表述，材料标注是原文划线，
//     不存在换个说法的问题；
//   · 模糊相似度 —— 匹配必须能向用户解释"为什么命中/没命中"。
//
// 宽划提示（不扣分）：命中但标注长度超过其命中证据总长的 2.5 倍，
// 多半是"划一大段蒙要点"——统计进 stats.wideMarks，由 UI 提醒「精确到句」。
//
// 一条标注可以命中多个点（一句话里有多层要点）；一个点被任一标注命中即算找到。
// 本模块零依赖、纯函数，可被 Node 直接 import（护栏：.tools/test-read-match.mjs）。

/** 归一化：只去空白。标点保留 —— 证据本来就要求与材料逐字一致 */
function norm(s) {
  return String(s || '').replace(/\s+/g, '')
}

/** 单条标注 × 单条证据；返回 { way, grade, evidence, keyword? } 或 null */
function hitEvidence(markText, evidence, keywords) {
  const m = norm(markText)
  const e = norm(evidence)
  if (!m || !e) return null
  if (m.includes(e)) return { way: 'cover', grade: 'full', evidence }
  if (e.includes(m)) {
    const ratio = m.length / e.length
    if (ratio >= 0.5) return { way: 'cover', grade: 'full', evidence }
    // 关键词先于 25% 线判：划中的正是要点词，way 展示语义更准（分级同为 partial）
    const kw = (keywords || []).find((k) => k && m.includes(norm(k)))
    if (kw) return { way: 'keyword', grade: 'partial', evidence, keyword: kw }
    if (ratio >= 0.25) return { way: 'partial', grade: 'partial', evidence }
  }
  return null
}

/** 单条标注 × 单个采分点：返回 [{ way, grade, evidence, keyword? }] 或 [] */
function hitPoint(markText, point) {
  const outs = []
  for (const ev of point?.evidence || []) {
    const h = hitEvidence(markText, ev, point?.keywords)
    if (h) outs.push(h)
  }
  return outs
}

/**
 * 主入口：把用户标注对照到采分点。
 * @param {Array} marks   用户标注 [{ text, nth, color?, id? }]
 * @param {Array} points  标准采分点 [{ id, label, weight, evidence, keywords? }]
 * @returns {{
 *   pointResults: [{ point, hit, grade: 'full'|'partial',
 *                    matched: [{ markId, markText, way, grade, evidence, keyword? }] }],
 *   markResults:  [{ mark, hitPointIds: [], wide: boolean }],
 *   stats: { totalPoints, hitPoints, fullPoints, partialPoints,
 *            totalWeight, hitWeight, scoreRate,
 *            totalMarks, validMarks, missMarks, wideMarks }
 * }}
 */
export function matchMarksToPoints(marks, points) {
  // 空白标注（纯空格/空串）没有位置含义，入口直接滤掉 —— 不能算进"已划 N 处"
  const ms = (Array.isArray(marks) ? marks : []).filter((m) => norm(m?.text))
  const ps = Array.isArray(points) ? points : []

  const pointResults = ps.map((point) => {
    const matched = []
    for (const mark of ms) {
      for (const h of hitPoint(mark?.text, point)) {
        matched.push({ markId: mark?.id || mark?.text, markText: mark?.text, ...h })
      }
    }
    // 点的分级取最好的一次命中：有过 full 就是 full，否则 partial
    const grade = matched.some((h) => h.grade === 'full') ? 'full' : 'partial'
    return { point, hit: matched.length > 0, grade, matched }
  })

  const markResults = ms.map((mark) => {
    const hitPointIds = pointResults
      .filter((pr) => pr.matched.some((x) => x.markText === mark?.text))
      .map((pr) => pr.point.id)
    // 宽划：命中的标注长度远超其踩中的证据总长 —— 划一大段蒙要点。
    // 只对命中标注统计（没命中的本来就算误划，不必再背一条"宽"）。
    const hitEvLen = pointResults
      .reduce((s, pr) => s + pr.matched
        .filter((x) => x.markText === mark?.text)
        .reduce((t, x) => t + norm(x.evidence).length, 0), 0)
    const wide = hitPointIds.length > 0
      && norm(mark?.text).length > hitEvLen * 2.5
    return { mark, hitPointIds, wide }
  })

  const totalWeight = ps.reduce((s, p) => s + (Number(p.weight) || 0), 0)
  const hitWeight = pointResults
    .filter((r) => r.hit)
    .reduce((s, r) => s + (Number(r.point.weight) || 0) * (r.grade === 'partial' ? 0.5 : 1), 0)
  const hitPoints = pointResults.filter((r) => r.hit).length
  const fullPoints = pointResults.filter((r) => r.grade === 'full').length
  const validMarks = markResults.filter((r) => r.hitPointIds.length > 0).length

  return {
    pointResults,
    markResults,
    stats: {
      totalPoints: ps.length,
      hitPoints,
      fullPoints,
      partialPoints: hitPoints - fullPoints,
      totalWeight,
      hitWeight: Math.round(hitWeight * 10) / 10,
      // 得分率按分值加权 —— 4 分的机制要点和 1 分的细节不应同价；部分命中折半
      scoreRate: totalWeight > 0 ? Math.round((hitWeight / totalWeight) * 1000) / 10 : 0,
      totalMarks: ms.length,
      validMarks,
      missMarks: ms.length - validMarks,
      wideMarks: markResults.filter((r) => r.wide).length,
    },
  }
}

/**
 * 漏掉要点的证据叠加层：把没找到的点的 evidence 转成红色荧光 mark，
 * 直接叠在材料上 —— 「你漏的就是这几句」一眼可见。
 * 证据在材料里找不到时跳过该条（材料被裁剪/证据失效都可能），不静默也不报错，
 * 由调用方按返回的 missing 数决定要不要提示。
 * @returns {{ overlay: Array, missing: number }}
 */
export function buildMissedOverlay(materialText, pointResults, countOccurrences) {
  const text = String(materialText || '')
  const overlay = []
  let missing = 0
  for (const pr of pointResults || []) {
    if (pr.hit) continue
    for (const ev of pr.point?.evidence || []) {
      const n = countOccurrences(text, ev)
      if (n > 0) overlay.push({ text: ev, nth: 0, color: 'red' })
      else missing += 1
    }
  }
  return { overlay, missing }
}
