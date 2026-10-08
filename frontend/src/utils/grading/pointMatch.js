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
// 判定规则（刻意保持可解释，三条）：
//   1. 标注 ⊇ 证据（整条证据都在标注里）→ 命中；
//   2. 证据 ⊇ 标注 且覆盖 ≥ 50% → 命中；
//   3. 证据 ⊇ 标注 覆盖 < 50%，但标注含该点任一关键词 → 命中
//      （只划到证据里的一个小词，若那个词正是关键词，也算找对了地方）。
//
// 刻意**不做**的：
//   · 关键词全材料扫描 —— 关键词（如"电商"）会在无关段落反复出现，
//     没碰到证据位置也判命中 = 把"划错地方"洗成"找对了"，训练就失去意义；
//   · synonyms —— 它是给**作答文字**用的等价表述，材料标注是原文划线，
//     不存在换个说法的问题；
//   · 模糊相似度 —— 匹配必须能向用户解释"为什么命中/没命中"。
//
// 一条标注可以命中多个点（一句话里有多层要点）；一个点被任一标注命中即算找到。
// 本模块零依赖、纯函数，可被 Node 直接 import（护栏：.tools/test-read-match.mjs）。

/** 归一化：只去空白。标点保留 —— 证据本来就要求与材料逐字一致 */
function norm(s) {
  return String(s || '').replace(/\s+/g, '')
}

/** 单条标注 × 单条证据 是否命中；返回命中的方式（用于展示）或 null */
function hitEvidence(markText, evidence, keywords) {
  const m = norm(markText)
  const e = norm(evidence)
  if (!m || !e) return null
  if (m.includes(e)) return { way: 'cover', evidence }
  if (e.includes(m)) {
    const ratio = m.length / e.length
    if (ratio >= 0.5) return { way: 'cover', evidence }
    const kw = (keywords || []).find((k) => k && m.includes(norm(k)))
    if (kw) return { way: 'keyword', evidence, keyword: kw }
  }
  return null
}

/** 单条标注 × 单个采分点：返回 [{ way, evidence, keyword? }] 或 [] */
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
 *   pointResults: [{ point, hit, matched: [{ markId, markText, way, evidence, keyword? }] }],
 *   markResults:  [{ mark, hitPointIds: [] }],
 *   stats: { totalPoints, hitPoints, totalWeight, hitWeight, scoreRate,
 *            totalMarks, validMarks, missMarks }
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
    return { point, hit: matched.length > 0, matched }
  })

  const markResults = ms.map((mark) => {
    const hitPointIds = pointResults
      .filter((pr) => pr.matched.some((x) => x.markText === mark?.text))
      .map((pr) => pr.point.id)
    return { mark, hitPointIds }
  })

  const totalWeight = ps.reduce((s, p) => s + (Number(p.weight) || 0), 0)
  const hitWeight = pointResults
    .filter((r) => r.hit)
    .reduce((s, r) => s + (Number(r.point.weight) || 0), 0)
  const hitPoints = pointResults.filter((r) => r.hit).length
  const validMarks = markResults.filter((r) => r.hitPointIds.length > 0).length

  return {
    pointResults,
    markResults,
    stats: {
      totalPoints: ps.length,
      hitPoints,
      totalWeight,
      hitWeight,
      // 得分率按分值加权 —— 4 分的机制要点和 1 分的细节不应同价
      scoreRate: totalWeight > 0 ? Math.round((hitWeight / totalWeight) * 1000) / 10 : 0,
      totalMarks: ms.length,
      validMarks,
      missMarks: ms.length - validMarks,
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
