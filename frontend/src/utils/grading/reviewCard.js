// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 复盘卡：把一份批改结果压成"下次动笔前先改哪三处"。
//
// 这份东西的价值不在"汇总"，而在**排序规则**：
//
//   圆桌跑完会有几十条意见（每位老师各 2~5 条批注 + 若干扣分项）。全摆给考生等于没给 ——
//   人会挑最容易改的那条去改，而不是最该改的那条。所以必须压缩到三点。
//
//   排序按 **共识优先**：几位老师**各自独立**提到同一类问题，说明它不是某位老师的口味，
//   而是这道答案实打实的硬伤；只有一位老师提到，可能是该老师的侧重点差异。
//   共识度相同时，再看**扣分多少**（老师认为它值多少分），最后看出现次数。
//
//   这个规则只在**多人**模式下成立。单人模式里每位"共识数"必然是 1，
//   这时排序实际退化成"按扣分排"—— UI 必须如实说，不能谎称"3 位老师都提到"。
//
// 为什么不需要再调模型：
//   意见本身已经在批改结果里了，再做一次 LLM 调用只是把同样的内容换个说法，
//   还会引入"两处说法不一致"的新问题。这里是纯代码聚合，可复算。

import { errorTypeById, matchErrorTypes, normalizeErrorType } from '../../data/error-taxonomy.js'

const uniq = (arr) => [...new Set(arr.filter(Boolean))]

function pickFirst(list, n) {
  const out = []
  const seen = new Set()
  for (const item of list) {
    const key = item.text
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
    if (out.length >= n) break
  }
  return out
}

/**
 * 从一份批改记录生成复盘卡。
 *
 * @param {object} record buildRecord() 产出的记录
 * @param {object} [opts]
 * @param {number} [opts.topN=3] 保留几处"最该改的"
 * @returns {{
 *   ok: boolean, reason: string,
 *   topFixes: Array<object>, checklist: Array<object>,
 *   stats: { teacherCount: number, consensusMeaningful: boolean, annotationTotal: number,
 *            deductionTotal: number, categories: Array<{id:string,label:string,count:number}> }
 * }}
 */
export function buildReviewCard(record, { topN = 3 } = {}) {
  const results = (record?.results || []).filter((r) => r && !r.error)
  const stats = {
    teacherCount: results.length,
    // 单人模式下"共识"这件事不成立，UI 要据此改口径
    consensusMeaningful: results.length >= 2,
    annotationTotal: 0,
    deductionTotal: 0,
    categories: [],
  }

  if (!results.length) {
    return {
      ok: false,
      reason: record?.results?.length
        ? '这次批改的老师都返回了错误，没有可复盘的意见'
        : '这份记录里没有批改结果',
      topFixes: [],
      checklist: [],
      stats,
    }
  }

  /** 按类型累积：每类都记住"谁提的、提的什么、扣了多少分" */
  const bucket = new Map()
  const touch = (id) => {
    if (!bucket.has(id)) {
      bucket.set(id, {
        id,
        teachers: new Set(),
        quotes: [],
        fixes: [],
        points: [],
        scoreLost: 0,
        occurrences: 0,
        detailTypes: [],
      })
    }
    return bucket.get(id)
  }

  for (const r of results) {
    const who = r.teacherId || ''

    // ① 逐句批注：一条批注可能同时命中几类（既漏点又照抄），都要算上
    for (const a of r.annotations || []) {
      const raw = a?.type
      if (!raw) continue
      stats.annotationTotal += 1
      for (const id of matchErrorTypes(raw)) {
        const b = touch(id)
        b.teachers.add(who)
        b.occurrences += 1
        b.detailTypes.push(String(raw))
        if (a.quote) b.quotes.push({ text: String(a.quote), teacher: who })
        if (a.fix) b.fixes.push({ text: String(a.fix), teacher: who })
      }
    }

    // ② 扣分项：带分值，是"这条值多少分"的直接证据
    for (const d of r.deductions || []) {
      const raw = d?.point
      if (!raw) continue
      stats.deductionTotal += 1
      const id = normalizeErrorType(raw)
      const b = touch(id)
      b.teachers.add(who)
      b.occurrences += 1
      b.detailTypes.push(String(raw))
      const sc = Number(d.score)
      if (Number.isFinite(sc) && sc > 0) b.scoreLost += sc
      if (d.point) b.points.push({ text: String(d.point), teacher: who })
      if (d.reason) b.points.push({ text: String(d.reason), teacher: who })
      if (d.fix) b.fixes.push({ text: String(d.fix), teacher: who })
    }
  }

  const all = [...bucket.values()].map((b) => ({
    ...b,
    teacherCount: b.teachers.size,
    teachers: [...b.teachers],
    detailTypes: uniq(b.detailTypes),
    topQuotes: pickFirst(b.quotes, 3),
    topFixes: pickFirst(b.fixes, 3),
    topPoints: pickFirst(b.points, 3),
    meta: errorTypeById(b.id),
  }))

  stats.categories = all
    .map((b) => ({ id: b.id, label: b.meta.label, count: b.teacherCount }))
    .sort((a, b) => b.count - a.count)

  // 「其他问题」不进 topFixes：它认不出类型，也就给不出能照做的改法，
  // 摆在第一位只会让人无从下手。它仍然留在 stats 里，供错题本统计。
  const ranked = all
    .filter((b) => b.id !== 'other')
    .sort((a, b) =>
      b.teacherCount - a.teacherCount
      || b.scoreLost - a.scoreLost
      || b.occurrences - a.occurrences)

  const topFixes = ranked.slice(0, Math.max(0, topN)).map((b, i) => ({
    rank: i + 1,
    categoryId: b.id,
    label: b.meta.label,
    desc: b.meta.desc,
    teacherCount: b.teacherCount,
    teachers: b.teachers,
    scoreLost: b.scoreLost,
    occurrences: b.occurrences,
    detailTypes: b.detailTypes,
    quotes: b.topQuotes,
    fixes: b.topFixes,
    points: b.topPoints,
    // 共识度 ≥2 才算"多位老师都提到了"；单人模式下这个标记一律为 false
    consensus: stats.consensusMeaningful && b.teacherCount >= 2,
    selfCheck: b.meta.selfCheck,
  }))

  const checklist = topFixes
    .filter((f) => f.selfCheck)
    .map((f) => ({ categoryId: f.categoryId, label: f.label, hint: f.selfCheck }))

  return { ok: topFixes.length > 0, reason: topFixes.length ? '' : '这次没批出可归类的具体问题', topFixes, checklist, stats }
}

/**
 * 跨多份记录的短板统计（错题本 / 能力画像的数据面）。
 *
 * 与复盘卡的区别：复盘卡看**一次**，这里看**一段时间**。
 * 排序按"出现过的记录份数"而不是"提到次数" ——
 * 一份答案里被同一位老师反复说同一件事，不该比"连续三次练习都在同一个坑里"更值得复习。
 *
 * @param {object[]} records 记录数组（新到旧或旧到新都行，这里只看数量）
 * @param {object} [opts]
 * @param {number} [opts.minRecords=1] 至少要出现在几份记录里才输出
 */
export function buildWeaknessProfile(records, { minRecords = 1 } = {}) {
  const list = (records || []).filter(Boolean)
  const map = new Map()

  for (const rec of list) {
    const card = buildReviewCard(rec, { topN: 0 })
    if (!card.stats.teacherCount) continue
    // 同一份记录里同一类只记一次：统计的是"栽了几次"，不是"被说了几句"
    for (const c of card.stats.categories) {
      if (c.id === 'other') continue
      if (!map.has(c.id)) {
        map.set(c.id, { id: c.id, label: c.label, recordIds: new Set(), occurrences: 0, scoreLost: 0 })
      }
      const e = map.get(c.id)
      e.recordIds.add(rec.id)
      e.occurrences += c.count
    }
  }

  const items = [...map.values()].map((e) => ({
    id: e.id,
    label: e.label,
    desc: errorTypeById(e.id).desc,
    selfCheck: errorTypeById(e.id).selfCheck,
    recordCount: e.recordIds.size,
    occurrences: e.occurrences,
    recordIds: [...e.recordIds],
  }))
    .filter((e) => e.recordCount >= minRecords)
    .sort((a, b) => b.recordCount - a.recordCount || b.occurrences - a.occurrences)

  return {
    recordCount: list.length,
    // 只有 ≥2 份有效记录时，"反复栽在同一个坑"这句话才成立
    enough: items.length > 0 && list.length >= 2,
    items,
  }
}
