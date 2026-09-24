// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 题目标准层（五层评分架构 · 第①层「grading_standard」）
//
// 为什么要有这一层：
//   现在五位老师是**现场裸判**——同一道题，每次批改的采分点都是模型临时想的，
//   于是"该题到底有几个得分点"变成随机数，分数自然不稳。
//   给题目预先备一份采分点标准（人工校准或 LLM 预解析 + 人工复核），
//   老师们就有了共同的锚，评分可比、可复算、可解释。
//
// 标准不替代老师的判断，只提供**共同参照**：
//   有标准的题走"标准 + 独立判断"，没有的题照旧裸判（不能因为没有标准就罢工）。

export const STANDARD_VERSION = '1.0'

/** 采分点状态：命中 / 部分 / 缺失 */
export const POINT_STATUS = { HIT: 'hit', PARTIAL: 'partial', MISS: 'miss' }

/**
 * @typedef {object} GradingPoint
 * @property {string}   id        该题内唯一，如 'p1'
 * @property {string}   label     采分点表述（一句话，供人读）
 * @property {number}   weight    分值
 * @property {string[]} evidence  材料中的**原文片段**（必须原样复制，供 LLM 定位与人工核对）
 * @property {string[]} keywords  关键判据词（纯代码可匹配，用于低成本粗判覆盖率）
 * @property {string[]} [synonyms] 同义表述：考生换一种说法表达同一要点时，同样算命中。
 *                                 留空则退回只看 keywords（会同义改写误判成 miss）。
 * @property {string[]} [forbidden_point] 反向要点：写出这些内容＝方向理解错了，该点不得分。
 *                                 用来防「方向写反了还给分」这类最伤信任的误判。
 * @property {string}   [note]    辨析提示（易混淆点、不给分的情形）
 *
 * @typedef {object} GradingStandard
 * @property {string} questionId
 * @property {GradingPoint[]} points
 * @property {number} totalScore
 * @property {'llm'|'manual'} source
 * @property {object} [meta]
 */

/** 校验一份标准是否合格；返回 { ok, errors } */
export function validateStandard(std) {
  const errors = []
  if (!std || typeof std !== 'object') return { ok: false, errors: ['标准不是对象'] }
  if (!std.questionId) errors.push('缺少 questionId')
  if (!Array.isArray(std.points) || !std.points.length) errors.push('points 为空')

  let sum = 0
  const seen = new Set()
  for (const [i, p] of (std.points || []).entries()) {
    const at = `points[${i}]`
    if (!p || typeof p !== 'object') {
      errors.push(`${at} 不是对象`)
      continue
    }
    if (!p.id) errors.push(`${at} 缺少 id`)
    else if (seen.has(p.id)) errors.push(`${at} id 重复：${p.id}`)
    seen.add(p.id)
    if (!p.label) errors.push(`${at} 缺少 label`)
    if (typeof p.weight !== 'number' || p.weight <= 0) errors.push(`${at} weight 必须是正数`)
    else sum += p.weight
    if (p.evidence != null && !Array.isArray(p.evidence)) errors.push(`${at} evidence 必须是数组`)
    if (p.keywords != null && !Array.isArray(p.keywords)) errors.push(`${at} keywords 必须是数组`)
    if (p.synonyms != null && !Array.isArray(p.synonyms)) errors.push(`${at} synonyms 必须是数组`)
    if (p.forbidden_point != null && !Array.isArray(p.forbidden_point))
      errors.push(`${at} forbidden_point 必须是数组`)
    // 同一个词既算"同义"又算"反向" —— 自相矛盾，该点永远判不准，必须在校验期拦下
    const both = (p.synonyms || []).filter((s) => (p.forbidden_point || []).includes(s))
    if (both.length) errors.push(`${at} synonyms 与 forbidden_point 有重复：${both.join('、')}`)
  }

  if (typeof std.totalScore === 'number' && sum && Math.abs(sum - std.totalScore) > 0.01) {
    errors.push(`各采分点之和 ${sum} 与 totalScore ${std.totalScore} 不一致`)
  }
  return { ok: errors.length === 0, errors, pointSum: sum }
}

/** 规范化：补 id/字段默认值，返回全新对象（不改原对象） */
export function normalizeStandard(raw) {
  if (!raw || typeof raw !== 'object') return null
  const points = (raw.points || [])
    .filter((p) => p && (p.label || p.point))
    .map((p, i) => ({
      id: String(p.id || `p${i + 1}`),
      label: String(p.label || p.point || '').trim(),
      weight: Number(p.weight ?? p.score ?? 0) || 0,
      evidence: Array.isArray(p.evidence) ? p.evidence.map(String) : [],
      keywords: Array.isArray(p.keywords) ? p.keywords.map(String) : [],
      synonyms: Array.isArray(p.synonyms) ? p.synonyms.map(String) : [],
      forbidden_point: Array.isArray(p.forbidden_point) ? p.forbidden_point.map(String) : [],
      note: p.note ? String(p.note) : '',
    }))
  if (!points.length) return null
  const sum = points.reduce((s, p) => s + p.weight, 0)
  return {
    questionId: String(raw.questionId || ''),
    points,
    totalScore: Number(raw.totalScore) || sum,
    source: raw.source === 'manual' ? 'manual' : 'llm',
    meta: raw.meta && typeof raw.meta === 'object' ? { ...raw.meta } : {},
  }
}

/** 去空白后的文本，供关键词匹配 */
function flat(text) {
  return String(text ?? '').replace(/\s+/g, '')
}

/**
 * 低成本粗判：纯代码判断考生答案是否覆盖某个采分点。
 *
 * 判据：
 *   HIT     —— 有 ≥8 字的材料原文片段原样出现在答案里，或关键词覆盖 ≥80%
 *   PARTIAL —— 只命中部分关键词
 *   MISS    —— 都没沾上
 *
 * ⚠️ 别把 HIT 的门槛写成"必须同时有 evidence 且关键词全覆盖"——
 *    那样**没有 evidence 的采分点永远只能是 partial**，覆盖率会被系统性低估。
 *    只用来给 LLM 一个"程序怎么看"的旁证，**不作为最终给分依据**。
 */
export function matchPoint(point, answer) {
  const a = flat(answer)
  const empty = { matchedEvidence: [], matchedKeywords: [], matchedSynonyms: [], matchedForbidden: [] }
  if (!a) return { status: POINT_STATUS.MISS, ...empty }

  // ⚠️ 反向要点**最先**判：方向写错了，命中多少关键词都不该给分。
  //    这是最伤信任的一类误判（"答反了还给分"），必须在判据的最前面拦。
  const matchedForbidden = (point.forbidden_point || []).filter(
    (f) => flat(f).length >= 2 && a.includes(flat(f))
  )
  if (matchedForbidden.length) {
    return { status: POINT_STATUS.MISS, ...empty, matchedForbidden, forbidden: true }
  }

  const matchedEvidence = (point.evidence || []).filter(
    (q) => flat(q).length >= 8 && a.includes(flat(q))
  )
  const kws = point.keywords || []
  const matchedKeywords = kws.filter((k) => a.includes(flat(k)))
  const kwRate = kws.length ? matchedKeywords.length / kws.length : 0
  // 同义表述：考生换一种说法表达同一要点也算命中。
  // 只靠 keywords 的硬字面匹配，会把"加强引导"遇上标准里的"强化引导"判成 miss。
  const matchedSynonyms = (point.synonyms || []).filter(
    (s) => flat(s).length >= 2 && a.includes(flat(s))
  )

  if (matchedEvidence.length >= 1 || matchedSynonyms.length >= 1 || kwRate >= 0.8) {
    return { status: POINT_STATUS.HIT, matchedEvidence, matchedKeywords, matchedSynonyms, matchedForbidden: [] }
  }
  if (matchedKeywords.length || matchedSynonyms.length) {
    return {
      status: POINT_STATUS.PARTIAL,
      matchedEvidence,
      matchedKeywords,
      matchedSynonyms,
      matchedForbidden: [],
    }
  }
  return { status: POINT_STATUS.MISS, ...empty }
}

/**
 * 采分点级比较：把标准逐点与考生答案对齐，给出命中情况与"按标准应得"的分。
 * 这是给合议层的一个**参照分**，不是最终分。
 */
export function compareWithStandard(standard, answer) {
  if (!standard?.points?.length) return null
  const rows = standard.points.map((p) => {
    const m = matchPoint(p, answer)
    const ratio = m.status === POINT_STATUS.HIT ? 1 : m.status === POINT_STATUS.PARTIAL ? 0.5 : 0
    return {
      ...p,
      status: m.status,
      matchedKeywords: m.matchedKeywords,
      matchedEvidence: m.matchedEvidence,
      matchedSynonyms: m.matchedSynonyms || [],
      matchedForbidden: m.matchedForbidden || [],
      forbidden: !!m.forbidden,
      earned: +(p.weight * ratio).toFixed(1),
    }
  })
  const earned = +rows.reduce((s, r) => s + r.earned, 0).toFixed(1)
  const weightedSum = standard.points.reduce((s, p) => s + p.weight, 0) || 1
  return {
    rows,
    earned,
    total: standard.totalScore || weightedSum,
    // 覆盖率按分值加权，而不是按点数，避免"小点凑数"
    coverage: Math.round((earned / weightedSum) * 100),
    hitCount: rows.filter((r) => r.status === POINT_STATUS.HIT).length,
    missCount: rows.filter((r) => r.status === POINT_STATUS.MISS).length,
    // 踩了反向要点的点数 —— 比"漏点"更严重：漏点是没写到，反了是理解错了方向
    forbiddenCount: rows.filter((r) => r.forbidden).length,
  }
}

/**
 * 把标准压成一段可注入提示词的文本。
 * 关键：明确告知"这是参照而非答案"，否则老师会退化成机械对答案。
 */
export function formatStandardForPrompt(standard, { maxScore = 0 } = {}) {
  if (!standard?.points?.length) return ''
  const total = standard.totalScore || maxScore || 0
  const lines = standard.points.map((p) => {
    const ev = p.evidence?.length ? `\n    材料依据：${p.evidence.map((e) => `「${e}」`).join(' ')}` : ''
    const syn = p.synonyms?.length
      ? `\n    同义表述（考生用其中任一种说法，都算命中）：${p.synonyms.join('、')}`
      : ''
    const fb = p.forbidden_point?.length
      ? `\n    ⛔ 反向要点（写出这些＝方向理解错误，本点不得分）：${p.forbidden_point.join('、')}`
      : ''
    const nt = p.note ? `\n    注意：${p.note}` : ''
    return `- [${p.id}] ${p.label}（${p.weight} 分）${ev}${syn}${fb}${nt}`
  })
  const src = standard.source === 'manual' ? '人工校准' : '模型预解析（已经人工复核）'
  return `【本题采分点标准（${src}，满分 ${total}）】
${lines.join('\n')}

使用方式：
1. 这份标准是**阅卷参照**，不是标准答案。考生用不同措辞表达同一要点，同样算命中——
   判断"意思是否到位"，不要做字面比对。
2. 逐点给出 status（hit 命中 / partial 部分 / miss 缺失），miss 的点必须列出来，
   这是你最有价值的部分（考生最需要知道"漏了哪个点"）。
3. 有标准时的 keyPoints 请**以这份标准的点为准**逐条作答，顺序保持一致。
4. 标准之外，如果考生写出了标准未收录但确实成立的好点，仍要肯定（写进 highlights）。
5. 标了「同义表述」的采分点：列出的那几种说法**都算命中**，不要做字面比对判成 miss。
6. 标了「⛔ 反向要点」的采分点：考生写出其中任一种表述，都说明这一点**方向理解错了**，
   该点一律给 miss（哪怕同时命中关键词）——「答反了」比「漏写了」更需要当面指出。

【keyPoints 必须回填标准 id（这条是硬要求）】
上面每个采分点前面方括号里的 [p1]、[p2]… 是它的**编号**。
你输出的 keyPoints 每一条都必须带上对应的 "pointId" 字段，值就是那个编号。
这意味着：
  · 共 ${standard.points.length} 条，不多不少，一条不能少（漏掉的也写出来、标 miss）；
  · "point" 字段里的文字请**原样照抄**上面的标准表述，不要自己改写、合并或拆分；
  · 考生用不同措辞表达同一要点时，**仍然算命中**（status 给 hit），但 pointId 不变。
为什么要这么死板：多老师批改时，三份 keyPoints 要按编号合并成一份。
如果各自改写表述，程序无法判断"这两条说的是同一个点"，就会重复计数，
考生看到的"漏点"会比实际多。**pointId 是唯一的对齐依据。**`
}

/** 供展示的简短摘要 */
export function summarizeStandard(standard) {
  if (!standard?.points?.length) return null
  return {
    source: standard.source,
    totalScore: standard.totalScore,
    pointCount: standard.points.length,
    points: standard.points.map((p) => ({ id: p.id, label: p.label, weight: p.weight })),
    // 录入完整度：有同义词/反向要点的标准，采分判定更准（也便于 UI 提示"这份标准还缺什么"）
    synonymCount: standard.points.reduce((s, p) => s + (p.synonyms?.length || 0), 0),
    forbiddenCount: standard.points.reduce((s, p) => s + (p.forbidden_point?.length || 0), 0),
  }
}
