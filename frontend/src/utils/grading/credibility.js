// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 评分可信度（五层架构第③层的「派生层」）
//
// 为什么要有这一层：
//   「AI 打的分能不能信」不能靠嘴说。①标准层给锚、③校验层给客观事实，而 ②④ 是模型判断 ——
//   模型的判断天然会浮动。**把这份浮动量化出来摆在分数旁边**，考生才知道这个数字是怎么来的：
//   「17.5 分」是结论，「三位老师一致、与程序独立粗判差 2.5 个百分点」才是让人敢相信它的理由。
//   这也是毕设里唯一能自证「这套评分不是玄学」的硬证据。
//
// 三条硬原则（改本文件前请先读）：
//   1. **只描述，不改写** —— 本模块一律不动 AI 的分数（与第③层校验层同理）。
//      它输出的是"这些数字能信到什么程度"，不是"应该打多少分"。
//   2. **没依据必须闭嘴** —— 单人批改算不出一致性，就标「不适用」，
//      **绝不写成"分歧 0%"**。把"无从判断"显示成"完美一致"是最恶劣的假信号，
//      和本项目反复复发的「假绿」是同一条病根：看着像通过，实际没测到任何东西。
//   3. **口径必随数走** —— 每个信号都带 `basis`，写清它是怎么算出来的
//      （"程序按关键词粗判""按分值加权"）。省掉口径，读者就会把参照值当成终值。
//
// 本模块**零副作用、只依赖 rules.js 的两个常量**，可被 Node 直接 import
// （护栏：.tools/test-credibility.mjs）。

import { DEDUCTION_CAP_RATIO } from './rules.js'

export const CREDIBILITY_VERSION = '1.0'

/** 可信度等级 */
export const LEVEL = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNKNOWN: 'unknown' }

/** 单个信号的判定 */
export const SIGNAL_LEVEL = { GOOD: 'good', WARN: 'warn', BAD: 'bad', NA: 'na' }

/**
 * 判据常量。
 * ⚠️ 这几个数字不是拍脑袋定的，改之前先看注释：
 */
export const THRESHOLDS = {
  /** 得分率极差 ≤5 个百分点 → 老师们基本一致 */
  spreadGoodPct: 5,
  /**
   * 极差 >15 个百分点 → 分歧过大。
   * 这不是新定的数字，而是**与流水线同一条线**：orchestrator.js 的 DISPUTE_THRESHOLD=0.15，
   * 超过它就触发圆桌辩论复核。可信度必须用同一个阈值，否则会出现
   * 「报告说有分歧、可信度说很一致」这种自相矛盾。
   */
  spreadBadPct: 15,
  /** 终评与程序粗判覆盖率之差 ≤8 个百分点 → 两个独立口径吻合 */
  deltaGoodPt: 8,
  deltaBadPt: 15,
  scoreHigh: 85,
  scoreMedium: 60,
  /** 需要压到「中等」时的分数上限（见 assessCredibility 的两处封顶） */
  mediumCapScore: 84,
  /**
   * 分数天花板：**再好的批改也不给满分**。
   * 这个模块能查的只是"几个口径是不是对得上"，而这几个口径自己也可能一起错
   * （比如标准本身就录错了、老师们共享同一个模型的偏见）。
   * 打出 100 分等于宣称"这次批得和人工一样准"，那是**过度承诺** ——
   * 满分的界面语言会盖过旁边所有的口径说明。
   */
  maxScore: 96,
}

const PENALTY = {
  spreadWarn: 8,
  spreadBad: 20,
  deltaWarn: 10,
  deltaBad: 22,
  parseFail: 25,
  parseFailMax: 50,
  rulesCapped: 5,
  reviewMissing: 10,
}

/** UI 用的展示文案与色值（沿用项目配色，别自创） */
export const LEVEL_TEXT = {
  [LEVEL.HIGH]: { label: '可信度高', color: '#4f7d5e', bg: '#e8ecdf' },
  [LEVEL.MEDIUM]: { label: '基本可信', color: '#9c6b2f', bg: '#f7eddc' },
  [LEVEL.LOW]: { label: '仅供参考', color: '#b4552d', bg: '#f7e9e4' },
  [LEVEL.UNKNOWN]: { label: '无从评估', color: '#7c756b', bg: '#efece6' },
}

// ─────────────────────────── 小工具 ───────────────────────────

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}

/** 一位老师的得分率；成绩不可用返回 null */
function toRate(r) {
  const max = Number(r?.maxScore) || 0
  const score = Number(r?.score)
  if (!max || !Number.isFinite(score)) return null
  return score / max
}

/** 总体标准差（不是样本标准差：这里就是样本全集，没打算外推） */
function stdDev(nums) {
  if (nums.length < 2) return 0
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length
  return Math.sqrt(variance)
}

function round1(n) {
  return +(Number(n) || 0).toFixed(1)
}

// ─────────────────────────── 主函数 ───────────────────────────

/**
 * 评估一次批改的可信度。
 *
 * @param {object}   opts
 * @param {Array}    opts.results    各老师的原始结果（含 score/maxScore/error）
 * @param {object}   [opts.final]    终评 { finalScore, maxScore }
 * @param {object}   [opts.standard] standardResolver 的粗判结果 { coverage, earned, total }
 * @param {object}   [opts.hardRules] 第③层产物 { rawDeduction, objectiveDeduction, capped }
 * @param {object}   [opts.debate]   圆桌辩论结果
 * @param {string}   [opts.mode]     solo | duo | roundtable
 * @returns {{version,level,score,headline,signals,reasons,caveats}}
 */
export function assessCredibility({
  results = [],
  final = null,
  standard = null,
  hardRules = null,
  debate = null,
  mode = '',
} = {}) {
  const list = Array.isArray(results) ? results.filter(Boolean) : []
  const failedList = list.filter((r) => r.error)
  const validResults = list.filter((r) => !r.error)
  const rates = validResults.map(toRate).filter((v) => v !== null && Number.isFinite(v))

  const signals = []
  const reasons = []
  const caveats = []
  let penalty = 0
  let cap = 100

  // ── 信号 1：老师一致性 ──────────────────────────────────────
  if (rates.length >= 2) {
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length
    const max = Math.max(...rates)
    const min = Math.min(...rates)
    const spreadPct = round1((max - min) * 100)
    const cvPct = mean ? round1((stdDev(rates) / mean) * 100) : 0

    let level = SIGNAL_LEVEL.GOOD
    if (spreadPct > THRESHOLDS.spreadBadPct) level = SIGNAL_LEVEL.BAD
    else if (spreadPct > THRESHOLDS.spreadGoodPct) level = SIGNAL_LEVEL.WARN
    if (level === SIGNAL_LEVEL.WARN) penalty += PENALTY.spreadWarn
    if (level === SIGNAL_LEVEL.BAD) penalty += PENALTY.spreadBad

    signals.push({
      id: 'agreement',
      label: '老师一致性',
      valueText: `${rates.length} 位老师得分率极差 ${spreadPct} 个百分点`,
      detail: `离散度 ${cvPct}%（标准差 ÷ 平均得分率）`,
      level,
      basis: `取每位老师「得分 ÷ 满分」的极差与离散度。> ${THRESHOLDS.spreadBadPct} 个百分点时流水线会触发圆桌复核辩论，与这里的判据是同一条线。`,
      note:
        level === SIGNAL_LEVEL.GOOD
          ? ''
          : '分歧本身不是坏事 —— 它说明这道题的判断空间大，建议把这个分数当成区间读',
    })
    if (level === SIGNAL_LEVEL.GOOD) reasons.push(`${rates.length} 位老师的判断基本一致（极差 ${spreadPct} 个百分点）`)
    if (level === SIGNAL_LEVEL.BAD) reasons.push(`几位老师分歧达 ${spreadPct} 个百分点`)
  } else {
    const none = !list.length || !rates.length
    signals.push({
      id: 'agreement',
      label: '老师一致性',
      valueText: '不适用',
      level: SIGNAL_LEVEL.NA,
      basis: none ? '本次没有任何有效成绩' : '只有一位老师的有效成绩，无从判断一致与否',
      note: none
        ? '这次批改没有产出可用成绩'
        : '单人批改没有第二个判断可以比对 —— 这不是「一致」，是「没得比」',
    })
    if (!none) caveats.push('本次是单人批改，分数只代表这一位老师（这一个模型）的判断')
  }

  // ── 信号 2：与程序按标准粗判的偏离 ───────────────────────────
  const finScore = Number(final?.finalScore)
  const finMax = Number(final?.maxScore)
  let finalRate = null
  if (Number.isFinite(finScore) && finMax > 0) finalRate = (finScore / finMax) * 100
  else if (rates.length) {
    // 终评缺失（老记录只存了 results）时用各位老师得分率的算术平均兜底。
    // ⚠️ 必须在 basis 里如实说明这是替代口径，不能假装它就是终评
    finalRate = (rates.reduce((a, b) => a + b, 0) / rates.length) * 100
  }
  const stdCov = Number.isFinite(Number(standard?.coverage)) ? Number(standard.coverage) : null

  if (finalRate !== null && stdCov !== null) {
    const deltaPt = round1(Math.abs(finalRate - stdCov))
    let level = SIGNAL_LEVEL.GOOD
    if (deltaPt > THRESHOLDS.deltaBadPt) level = SIGNAL_LEVEL.BAD
    else if (deltaPt > THRESHOLDS.deltaGoodPt) level = SIGNAL_LEVEL.WARN
    if (level === SIGNAL_LEVEL.WARN) penalty += PENALTY.deltaWarn
    if (level === SIGNAL_LEVEL.BAD) penalty += PENALTY.deltaBad

    signals.push({
      id: 'standardAgreement',
      label: '与程序粗判的吻合度',
      valueText: `终评 ${round1(finalRate)}% vs 程序粗判 ${stdCov}%，差 ${deltaPt} 个百分点`,
      detail: `程序粗判估算得分 ${standard?.earned ?? '—'} / ${standard?.total ?? '—'} 分`,
      level,
      basis:
        '程序粗判＝按采分点标准的「关键词 + 材料原文片段」匹配来算，覆盖率按分值加权。它完全不读老师的输出，是**独立口径**；两者吻合说明分数不是某一方的偶然判断。',
      note:
        level === SIGNAL_LEVEL.GOOD
          ? '两个互不相干的口径给出接近的结论，是这套评分最强的一条旁证'
          : '粗判只看关键词与原文片段，不能理解同义改写，所以偏低的那一侧往往偏保守',
    })
    if (level === SIGNAL_LEVEL.GOOD) reasons.push(`与程序按标准的独立粗判只差 ${deltaPt} 个百分点`)
    else if (level === SIGNAL_LEVEL.BAD) reasons.push(`与程序按标准的独立粗判差了 ${deltaPt} 个百分点`)
  } else {
    signals.push({
      id: 'standardAgreement',
      label: '与程序粗判的吻合度',
      valueText: '不适用',
      level: SIGNAL_LEVEL.NA,
      basis: stdCov === null ? '该题没有录入采分点标准' : '终评与各位老师的成绩都不可用',
      note: '没有预先录入的采分点标准，这次批改缺一个独立于模型的锚点',
    })
    if (stdCov === null) {
      caveats.push('本题没有采分点标准，分数只由模型判断得出，跨题目的可比性也较弱')
    }
  }

  // ── 信号 3：阅卷完成度（有没有人掉链子） ────────────────────
  if (list.length) {
    const level = failedList.length ? SIGNAL_LEVEL.BAD : SIGNAL_LEVEL.GOOD
    penalty += Math.min(failedList.length * PENALTY.parseFail, PENALTY.parseFailMax)
    signals.push({
      id: 'completeness',
      label: '阅卷完成度',
      valueText: failedList.length
        ? `${rates.length} / ${list.length} 位老师给出可用成绩（${failedList.length} 位解析失败）`
        : `${list.length} 位老师全部给出了可用成绩`,
      level,
      basis: '统计结果里 `error` 非空或成绩不可用的老师人数',
      note: failedList.length ? '失败的老师没有参与合议，最终结论的证据基础不完整' : '',
    })
    if (failedList.length) {
      reasons.push(`${failedList.length} 位老师的结果解析失败，合议基础不完整`)
      cap = Math.min(cap, THRESHOLDS.mediumCapScore)
    }
  }

  // ── 信号 4：客观校验是否被引擎封顶 ──────────────────────────
  if (hardRules && typeof hardRules === 'object') {
    const capped = !!hardRules.capped
    if (capped) penalty += PENALTY.rulesCapped
    signals.push({
      id: 'ruleCap',
      label: '客观校验',
      valueText: capped
        ? `程序算出客观扣分 ${hardRules.rawDeduction} 分，已封顶为 ${hardRules.objectiveDeduction} 分`
        : `程序算出的客观扣分 ${hardRules.rawDeduction} 分，未触及封顶`,
      level: capped ? SIGNAL_LEVEL.WARN : SIGNAL_LEVEL.GOOD,
      basis: `第③层硬规则纯代码计算（字数 / 格式 / 结构 / 重复照抄）；客观扣分封顶为满分的 ${Math.round(
        DEDUCTION_CAP_RATIO * 100
      )}%，避免规则层一票否决 AI 的判断。`,
      note: capped
        ? '规则层认为该扣的比分超过了封顶线 —— 多出来的部分 AI 没有扣，这个分数偏宽容'
        : '',
    })
    if (capped) {
      caveats.push(
        '客观扣分被封顶：程序算出的扣分超过上限、只计入了封顶值，AI 给出的分数可能比规则层更宽容'
      )
    }
  }

  // ── 信号 5：分歧有没有真的被复核 ────────────────────────────
  const spreadForReview = rates.length >= 2 ? (Math.max(...rates) - Math.min(...rates)) * 100 : 0
  if ((mode === 'roundtable' || list.length >= 3) && rates.length >= 2) {
    const disputed = spreadForReview > THRESHOLDS.spreadBadPct
    const reviewed = !!(debate && Array.isArray(debate.disputes) && debate.disputes.length)
    const level = !disputed ? SIGNAL_LEVEL.NA : reviewed ? SIGNAL_LEVEL.GOOD : SIGNAL_LEVEL.BAD
    if (disputed && !reviewed) penalty += PENALTY.reviewMissing
    signals.push({
      id: 'review',
      label: '分歧复核',
      valueText: !disputed ? '未触发（分歧未超阈值）' : reviewed ? '已由圆桌辩论裁定' : '触发了但缺少复核结论',
      level,
      basis: `三人及以上模式下，得分率极差 > ${THRESHOLDS.spreadBadPct} 个百分点会走一轮圆桌辩论`,
      note: '',
    })
  }

  // ── 汇总 ────────────────────────────────────────────────────
  const noData = !rates.length || finalRate === null
  if (noData) {
    return {
      version: CREDIBILITY_VERSION,
      level: LEVEL.UNKNOWN,
      score: 0,
      headline: '这次批改没有产出可用成绩，无从评估可信度',
      signals,
      reasons,
      caveats,
    }
  }

  // 单人 + 无标准：既没有人可以互相印证，也没有锚点可以对⻬，
  // 这时无论其它信号多好看，都只能算「基本可信」。
  // ⚠️ 为什么封顶而不是扣分：这两项缺失**不是错误**，给低分没有依据；
  //    但它们确实意味着「没有任何交叉验证」，所以不该显示成「可信度高」。
  if (rates.length < 2 && stdCov === null) {
    cap = Math.min(cap, THRESHOLDS.mediumCapScore)
  }

  const score = Math.min(clamp(Math.round(100 - penalty), 0, 100), cap, THRESHOLDS.maxScore)
  const level =
    score >= THRESHOLDS.scoreHigh
      ? LEVEL.HIGH
      : score >= THRESHOLDS.scoreMedium
        ? LEVEL.MEDIUM
        : LEVEL.LOW

  const headlineMap = {
    [LEVEL.HIGH]: '可以采信：多个独立口径互相印证',
    [LEVEL.MEDIUM]: '基本可信，但有一处打了折',
    [LEVEL.LOW]: '仅供参考，别当成结论',
  }

  return {
    version: CREDIBILITY_VERSION,
    level,
    score,
    headline: headlineMap[level] || '',
    signals,
    reasons,
    caveats,
  }
}

/** 给列表页/记录页用的一句话版本 */
export function credibilityLine(credibility) {
  if (!credibility || credibility.level === LEVEL.UNKNOWN) return ''
  const t = LEVEL_TEXT[credibility.level]
  if (!t) return ''
  const top = credibility.reasons?.[0]
  return `${t.label}·${credibility.score}${top ? `（${top}）` : ''}`
}
