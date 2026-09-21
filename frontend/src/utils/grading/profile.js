// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 能力画像：把历史记录压成几个**口径固定**的维度分。
//
// 为什么不能直接用老师给的 dimensions：
//   早期版本（StatsView 的雷达图）直接聚合 `results[].dimensions[].name`，
//   那是模型自由文本——「要点覆盖」「覆盖度」「要点完整性」会被当成三个不同的轴，
//   轴的数量和内容随记录漂移，同一个人的画像隔一天就变了样。
//   聚合的前提是**口径先定死**，这正是 data/error-taxonomy.js 存在的理由，
//   所以这里全部走那张表，不碰自由文本。
//
// 三条不能破（和 credibility.js 同源的规矩）：
//   ① **样本不够就闭嘴**。一篇记录画出来的雷达图会让读者误以为"我的能力就是这样"，
//      那是本项目最忌的假信号。低于 MIN_RECORDS 时整份画像标 `ready:false`，
//      由 UI 决定不画图 —— 本模块不替 UI 撒谎。
//   ② **每个维度必须带 basis**。没口径的数字就是来历不明的断言。
//   ③ **没数据 ≠ 满分**。某维度一篇都没判过时标 `applicable:false`，
//      UI 要显示成「未评」，绝不能画到外圈（画到外圈＝告诉用户"这项你很强"）。
//
// ⚠️ 维度的归并关系写死后**只能追加**：历史记录里存的是维度 id 与错误类型 id，
//    改映射等于把旧数据重新解释一遍。

// ⚠️ 写全 `.js` 后缀：本模块要保持能被 Node 直接 import（.tools/test-profile.mjs 要跑它）。
import { POINT_STATUS } from '../../agents/grading/standard.js'
import { normalizeErrorType, errorTypeLabel } from '../../data/error-taxonomy.js'

/** 少于这么多篇，画像不成立（噪声压过信号） */
export const MIN_RECORDS = 3

/**
 * 六个固定维度。`errors` 列出归入该维度的错误类型 id，
 * 得分 = 100 × (1 − 该类问题在参与统计的篇数中的出现率)。
 */
export const PROFILE_DIMENSIONS = [
  {
    id: 'coverage',
    label: '要点覆盖',
    // 这一维**不是**靠错误率算的，而是采分点命中率（越正面越准），单独走一条路
    fromPoints: true,
    basis: '按分值加权：命中记满分、部分记半分，除以采分点总分',
  },
  {
    id: 'material',
    label: '材料运用',
    errors: ['copy-raw', 'over-generalize'],
    basis: '出现「整句照抄 / 概括失真」的篇数占比，占比越低分越高',
  },
  {
    id: 'structure',
    label: '结构条理',
    errors: ['structure'],
    basis: '出现「结构失当」的篇数占比，占比越低分越高',
  },
  {
    id: 'relevance',
    label: '审题应题',
    errors: ['off-question', 'point-split', 'point-merge'],
    basis: '出现「形式不应题 / 拆点 / 分类混乱」的篇数占比，占比越低分越高',
  },
  {
    id: 'expression',
    label: '语言表达',
    errors: ['expression', 'empty-talk'],
    basis: '出现「表述不规范 / 空话套话」的篇数占比，占比越低分越高',
  },
  {
    id: 'norm',
    label: '规范体例',
    errors: ['word-count', 'format'],
    basis: '出现「字数失当 / 格式体例」的篇数占比，占比越低分越高',
  },
]

/**
 * 取一篇记录里所有被判到的错误类型（去重）。
 * 一条批注可能算多类（matchErrorTypes 的能力），但按**主类**计一次更稳——
 * 否则"既漏点又抄句"会在两个维度各记一次，把画像整体压低。
 */
function errorTypesOfRecord(record) {
  const set = new Set()
  for (const r of record?.results || []) {
    if (r?.error) continue
    for (const a of r?.annotations || []) {
      const raw = a?.type || ''
      if (!String(raw).trim()) continue
      set.add(normalizeErrorType(raw))
    }
  }
  return set
}

/** 一篇记录有没有任何批注（没有批注的篇不参与"未出现即好"的统计） */
function hasAnnotations(record) {
  return (record?.results || []).some(
    (r) => !r?.error && (r?.annotations || []).some((a) => String(a?.type || '').trim())
  )
}

/** 采分点命中率（0~100）；没有采分点数据时返回 null（不是 0！） */
function coverageOfRecord(record) {
  const kps = Array.isArray(record?.keyPoints) ? record.keyPoints.filter((k) => !k.extra) : []
  if (!kps.length) return null
  const total = kps.reduce((s, k) => s + (Number(k.weight) || 0), 0)
  if (total <= 0) return null
  // earned 缺失时按 status 折回，保证与 mergeKeyPoints 的口径一致
  const earned = kps.reduce((s, k) => {
    const w = Number(k.weight) || 0
    const e = Number(k.earned)
    if (Number.isFinite(e) && e > 0) return s + e
    return s + (k.status === POINT_STATUS.HIT ? w : k.status === POINT_STATUS.PARTIAL ? w / 2 : 0)
  }, 0)
  return Math.min(100, Math.round((earned / total) * 100))
}

/**
 * 生成一份能力画像。
 *
 * @param {Array} records 历史记录（listAllRecords() 的结果）
 * @returns {{
 *   ready: boolean, recordCount: number, need: number,
 *   dimensions: Array<{id,label,score:number|null,applicable:boolean,samples:number,basis:string,topErrors:string[]}>
 * }}
 */
export function buildProfile(records = []) {
  const list = (Array.isArray(records) ? records : []).filter(Boolean)
  const ready = list.length >= MIN_RECORDS

  // 有批注的篇才参与"没被批 = 这项还行"的推断；
  // 一篇批注都没有的记录加进来，会把所有维度无脑推高（最典型的假信号）。
  const judged = list.filter(hasAnnotations)

  const dimensions = PROFILE_DIMENSIONS.map((dim) => {
    // ── 要点覆盖：正面指标，走采分点 ──
    if (dim.fromPoints) {
      const vals = list.map(coverageOfRecord).filter((v) => v !== null)
      if (!vals.length) {
        return {
          id: dim.id,
          label: dim.label,
          score: null,
          applicable: false,
          samples: 0,
          basis: dim.basis,
          topErrors: [],
        }
      }
      return {
        id: dim.id,
        label: dim.label,
        score: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
        applicable: true,
        samples: vals.length,
        basis: dim.basis,
        topErrors: [],
      }
    }

    // ── 其余：负面指标的"未出现率" ──
    const pool = judged.length ? judged : []
    const errors = dim.errors || []
    let hit = 0
    const topErrors = []
    for (const r of pool) {
      const types = errorTypesOfRecord(r)
      const inThis = errors.filter((e) => types.has(e))
      if (inThis.length) {
        hit++
        topErrors.push(...inThis)
      }
    }
    if (!pool.length) {
      return {
        id: dim.id,
        label: dim.label,
        score: null,
        applicable: false,
        samples: 0,
        basis: dim.basis,
        topErrors: [],
      }
    }
    return {
      id: dim.id,
      label: dim.label,
      score: Math.round((1 - hit / pool.length) * 100),
      applicable: true,
      samples: pool.length,
      basis: dim.basis,
      topErrors: [...new Set(topErrors)].map((id) => errorTypeLabel(id)),
    }
  })

  return {
    ready,
    recordCount: list.length,
    judgedCount: judged.length,
    need: Math.max(0, MIN_RECORDS - list.length),
    dimensions,
  }
}

/**
 * 一句话总结：最弱的一维（供 UI 显示"先补哪里"）。
 * ⚠️ 没成立（ready=false）或所有维度都不适用时返回 null ——
 *    随便挑一个说"你这方面最弱"，比不说更误导（与 nextQuestion.js 同一条规矩）。
 */
export function weakestDimension(profile) {
  if (!profile?.ready) return null
  const usable = (profile.dimensions || []).filter((d) => d.applicable && d.score !== null)
  if (usable.length < 2) return null
  return usable.reduce((a, b) => (b.score < a.score ? b : a))
}
