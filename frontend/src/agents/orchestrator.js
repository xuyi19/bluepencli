// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 多老师阅卷调度引擎
//
// 流程：
//   阶段1 独立阅卷（并行）→ 阶段2 分歧检测 → 阶段3 圆桌辩论（按需）
//   → 阶段4 合议融合 → 阶段5 结构化输出
//
// 支持 1~5 位老师任意组合：单人直接出结果，双人加权合并，
// 三人及以上走完整圆桌（辩论 + 合议）。

import { chat } from '../api/llm'
import { reportTask } from '../api/backend'
import { TEACHERS, getTeachers, detectMode } from './teachers'
import {
  buildTeacherSystem,
  buildTeacherSystemDeep,
  DEBATE_SYSTEM,
  DEBATE_SCHEMA,
  FUSION_SYSTEM,
  FUSION_SCHEMA,
} from './skills'
import { parseJson } from '../utils/parse'
// 第①层：题目标准层（采分点）——有则注入，无则裸判，绝不因此中断批改
import { resolveStandard, buildStandardPrompt, buildStandardComparison } from './grading/standardResolver'
// 第③层：校验层（硬规则）——纯代码算出来的客观事实
import { runHardRules, formatRulesForPrompt } from '../utils/grading/rules'
// 第③层派生：评分可信度（纯代码，描述这套分数能信到什么程度，不改写分数）
import { assessCredibility } from '../utils/grading/credibility'
// 多老师采分点归并：必须去重并对齐标准，不能直接 flatMap（会把同一采分点拼 N 次）
import { mergeKeyPoints } from '../utils/grading/keyPoints'

// 分歧阈值：最高分与最低分得分率差值超过此值即触发复核
export const DISPUTE_THRESHOLD = 0.15

// 每位老师的采样温度：越依赖客观规则越低，越依赖综合判断越高
const TEMPERATURE = {
  yuandong: 0.1,
  zhoutairan: 0.15,
  bailu: 0.3,
  kiwi: 0.4,
  lichongli: 0.3,
}

function genTaskId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function buildPaper({ title, requirement, material, answer, maxScore, wordLimit }) {
  return `【题目】${title || '（未填写题目）'}
【作答要求】${requirement || '（未填写）'}
【字数要求】${wordLimit ? wordLimit + ' 字' : '按题目要求'}
【该题满分】${maxScore} 分

【给定资料】
${material || '（未提供资料）'}

【考生作答】
${answer}`
}

/** 阶段1：单个老师独立阅卷 */
async function gradeByTeacher(teacher, paper, { onProgress, signal, deep, taskId, extra = '' }) {
  onProgress?.({ type: 'teacher:start', teacherId: teacher.id })
  const system = deep
    ? await buildTeacherSystemDeep(teacher.id, { extra })
    : buildTeacherSystem(teacher.id, { extra })

  const text = await chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: paper },
    ],
    stream: true,
    signal,
    temperature: TEMPERATURE[teacher.id] ?? 0.3,
    meta: { task_id: taskId, teacher_id: teacher.id, stage: 'grade' },
    onDelta: (_d, full) => {
      onProgress?.({ type: 'teacher:delta', teacherId: teacher.id, text: full })
    },
  })
  const parsed = parseJson(text)
  onProgress?.({ type: 'teacher:done', teacherId: teacher.id, result: parsed, raw: text })
  if (!parsed) {
    return {
      teacherId: teacher.id,
      teacherName: teacher.name,
      error: '解析失败',
      rawText: text,
      score: 0,
      maxScore: 0,
      dimensions: [],
      deductions: [],
      suggestions: [],
      summary: '该老师的批改结果解析失败，原始输出已保留。',
    }
  }
  parsed.teacherId = teacher.id
  // 带上名字：采分点归并时要标注「这条是哪几位老师给的」
  parsed.teacherName = teacher.name
  parsed.rawText = text
  return parsed
}

/** 阶段2：分歧检测 */
export function detectDispute(results) {
  const valid = results.filter((r) => !r.error && typeof r.score === 'number' && r.maxScore)
  if (valid.length < 2) return { disputed: false, valid }

  const rates = valid.map((r) => r.score / r.maxScore)
  const max = Math.max(...rates)
  const min = Math.min(...rates)
  const spread = max - min

  // 各老师维度集不同（本来设计就不同），这里看的是同类维度上的判断差异
  const dimensionSets = valid.map((r) => (r.dimensions || []).map((d) => d.name).join('|'))
  const dimensionDiffer = new Set(dimensionSets).size > 1

  return {
    disputed: spread > DISPUTE_THRESHOLD,
    spread,
    spreadPct: +(spread * 100).toFixed(1),
    maxRate: +(max * 100).toFixed(1),
    minRate: +(min * 100).toFixed(1),
    dimensionDiffer,
    valid,
  }
}

/** 阶段3：圆桌辩论复核（仅在有分歧时执行） */
async function debate(results, paper, { onProgress, signal, taskId, facts = '' }) {
  onProgress?.({ type: 'stage', stage: 'debate' })
  const summaries = results
    .filter((r) => !r.error)
    .map((r) => {
      const t = TEACHERS[r.teacherId]
      return `【${t.name}（${t.title}｜侧重：${t.focus}）】得分 ${r.score}/${r.maxScore}
总评：${r.summary || ''}
分项：${(r.dimensions || []).map((d) => `${d.name} ${d.score}/${d.max}`).join('，')}
扣分点：${(r.deductions || []).map((d) => d.point).join('；') || '无'}`
    })
    .join('\n\n')

  const text = await chat({
    messages: [
      { role: 'system', content: `${DEBATE_SYSTEM}\n\n${DEBATE_SCHEMA}` },
      {
        role: 'user',
        content: `${paper}\n\n===== 各位老师的独立评分 =====\n${summaries}${
          facts ? '\n\n' + facts : ''
        }`,
      },
    ],
    stream: true,
    signal,
    temperature: 0.2,
    meta: { task_id: taskId, stage: 'debate' },
    onDelta: (_d, full) => onProgress?.({ type: 'stage:delta', stage: 'debate', text: full }),
  })
  return parseJson(text)
}

/** 阶段4：观点融合（合议） */
async function fuse(results, debateResult, paper, { onProgress, signal, taskId, facts = '' }) {
  onProgress?.({ type: 'stage', stage: 'fusion' })
  const details = results
    .filter((r) => !r.error)
    .map((r) => {
      const t = TEACHERS[r.teacherId]
      return `【${t.name}｜${t.title}｜权重 ${t.weight}｜得分 ${r.score}/${r.maxScore}】
总评：${r.summary || ''}
分项：${(r.dimensions || []).map((d) => `${d.name} ${d.score}/${d.max}`).join('，')}
扣分：${(r.deductions || []).map((d) => `${d.point}（-${d.score}）`).join('；') || '无'}
漏答要点：${(r.keyPoints || []).filter((k) => k.status === 'miss').map((k) => k.point).join('；') || '无'}
亮点：${(r.highlights || []).map((h) => h.point).join('；') || '无'}`
    })
    .join('\n\n')

  const debateText = debateResult
    ? `\n\n===== 圆桌仲裁结论 =====\n${(debateResult.disputes || [])
        .map((d) => `【${d.topic}】裁定：${d.ruling}（依据：${d.reason || '—'}）`)
        .join('\n')}\n\n复核总体说明：${debateResult.overall || '—'}`
    : ''

  const text = await chat({
    messages: [
      { role: 'system', content: `${FUSION_SYSTEM}\n\n${FUSION_SCHEMA}` },
      {
        role: 'user',
        content: `${paper}\n\n===== 各老师独立批改 =====\n${details}${debateText}${
          facts ? '\n\n' + facts : ''
        }`,
      },
    ],
    stream: true,
    signal,
    temperature: 0.2,
    meta: { task_id: taskId, stage: 'consensus' },
    onDelta: (_d, full) => onProgress?.({ type: 'stage:delta', stage: 'fusion', text: full }),
  })
  return parseJson(text)
}

/** 加权计分（单人/双人合并、以及合议失败时的兜底） */
function weightedScore(results, teachers) {
  const valid = results.filter((r) => !r.error && r.maxScore)
  if (!valid.length) return null
  const maxScore = valid[0].maxScore
  let sum = 0
  let weightSum = 0
  const breakdown = []
  for (const r of valid) {
    const t = TEACHERS[r.teacherId]
    const w = t?.weight ?? 1
    sum += r.score * w
    weightSum += w
    breakdown.push({ teacherId: r.teacherId, name: t?.name, score: r.score, weight: w })
  }
  const final = sum / weightSum
  return { finalScore: +final.toFixed(1), maxScore, breakdown }
}

/** 把各老师的分数档位合并成一个描述 */
function joinLevels(results) {
  const levels = results.filter((r) => !r.error && r.level).map((r) => `${TEACHERS[r.teacherId]?.name}：${r.level}`)
  return levels.join(' / ')
}

/**
 * 主流程
 * @param {object}   opts
 * @param {object}   opts.paper        题目与作答
 * @param {string[]} opts.teacherIds   选中的老师
 * @param {boolean}  opts.deep         是否注入完整方法论原文（更准、更慢、更贵）
 * @param {Function} opts.onProgress   进度回调
 * @param {AbortSignal} opts.signal
 */
export async function runGrading({ paper: paperInput, teacherIds, deep = false, onProgress, signal }) {
  const teachers = getTeachers(teacherIds)
  if (!teachers.length) throw new Error('请至少选择一位阅卷老师')

  const mode = detectMode(teacherIds)
  const paper = buildPaper(paperInput)
  const startedAt = Date.now()
  const taskId = genTaskId()

  onProgress?.({ type: 'mode', mode, teacherIds, deep })

  // ---------- 阶段0：客观校验（纯代码，先于模型） ----------
  // 放在最前面有两个好处：① 结果与模型无关，可复算；② 万一模型全挂了，
  // 至少还能告诉考生"字数超了 87 字""整段照抄材料"这种板上钉钉的事实。
  const hardRules = runHardRules({
    answer: paperInput.answer || '',
    material: paperInput.material || '',
    requirement: paperInput.requirement || '',
    wordLimit: Number(paperInput.wordLimit) || 0,
    maxScore: Number(paperInput.maxScore) || 0,
    type: paperInput.questionType || '',
  })
  onProgress?.({ type: 'rules', hardRules })

  // ---------- 阶段0.5：取该题的采分点标准（有则注入，无则为空串） ----------
  const stdPrompt = buildStandardPrompt(paperInput.questionId, {
    maxScore: Number(paperInput.maxScore) || 0,
  })
  const stdInfo = resolveStandard(paperInput.questionId)
  onProgress?.({
    type: 'standard',
    hasStandard: !!stdInfo.standard,
    pointCount: stdInfo.standard?.points?.length || 0,
  })

  // 硬规则的客观事实：给辩论与合议当旁证，避免"字数明显不够"却几位老师都不提
  const facts = formatRulesForPrompt(hardRules)

  // ---------- 阶段1：并行独立阅卷 ----------
  onProgress?.({ type: 'stage', stage: 'grading' })
  const results = await Promise.all(
    teachers.map((t) => gradeByTeacher(t, paper, { onProgress, signal, deep, taskId, extra: stdPrompt }))
  )

  // ---------- 阶段2：分歧检测 ----------
  onProgress?.({ type: 'stage', stage: 'detect' })
  const dispute = detectDispute(results)
  onProgress?.({ type: 'dispute', dispute })

  const output = {
    taskId,
    mode,
    teacherIds,
    deep,
    teachers: teachers.map((t) => ({
      id: t.id, name: t.name, title: t.title, color: t.color, avatar: t.avatar,
      weight: t.weight, focus: t.focus, school: t.school,
    })),
    results,
    dispute,
    debate: null,
    fusion: null,
    // 第③层产物：客观校验（字数/格式/结构/重复），纯代码可复算
    hardRules,
    // 第①层产物：采分点标准的逐点覆盖情况（无标准时为 null）
    standard: buildStandardComparison(paperInput.questionId, paperInput.answer || ''),
    elapsed: 0,
    createdAt: startedAt,
  }

  // 收尾：算耗时、定可信度，并向后端上报任务记录（后端不可用时静默跳过）
  //
  // 可信度放在这里算而不是在结果页现算，原因很具体：结果页拿不到 `standard`
  // （标准是通过 orchestrator 注入的，记录里没存），而记录必须长期可读 ——
  // 三个月后回看一份存档，也要能知道"当时这个分数有多少依据"。
  const finish = () => {
    output.elapsed = Date.now() - startedAt
    output.credibility = assessCredibility({
      results,
      final: output.final,
      standard: output.standard,
      hardRules,
      debate: output.debate,
      mode: output.mode,
    })
    onProgress?.({ type: 'credibility', credibility: output.credibility })
    reportTask({
      task_id: taskId,
      mode,
      teacher_ids: teacherIds,
      question_type: paperInput.questionType || '',
      title: paperInput.title || '',
      answer_chars: (paperInput.answer || '').length,
      deep,
      final_score: output.final?.finalScore || 0,
      max_score: output.final?.maxScore || 0,
      elapsed_ms: output.elapsed,
      llm_calls: teachers.length + (output.debate ? 1 : 0) + (output.fusion ? 1 : 0),
      disputed: !!output.dispute?.disputed,
      status: 'success',
    })
    return output
  }

  // ---------- 单人：直接输出 ----------
  if (mode === 'solo') {
    const r = results[0]
    const t = teachers[0]
    output.final = {
      finalScore: r.error ? 0 : r.score,
      maxScore: r.maxScore || paperInput.maxScore,
      level: r.level || '—',
      dimensions: r.dimensions || [],
      criticalIssues: (r.deductions || []).map((d) => ({ issue: d.point, source: t.name, fix: d.fix })),
      minorIssues: [],
      highlights: r.highlights || [],
      summary: r.summary || '',
      suggestions: r.suggestions || [],
      roundtableNote: `${t.name}（${t.title}）独立批改 · 侧重 ${t.focus}`,
      keyPoints: r.keyPoints || [],
    }
    return finish()
  }

  // ---------- 双人：加权合并 ----------
  if (mode === 'duo') {
    const ws = weightedScore(results, teachers)
    const issues = []
    for (const r of results) {
      const t = TEACHERS[r.teacherId]
      for (const d of r.deductions || []) {
        issues.push({ issue: d.point, source: t?.name || '', fix: d.fix })
      }
    }
    const dims = []
    for (const r of results) {
      for (const d of r.dimensions || []) {
        dims.push({
          name: `${d.name}（${TEACHERS[r.teacherId]?.name}）`,
          score: d.score, max: d.max, comment: d.comment,
        })
      }
    }
    output.final = {
      finalScore: ws?.finalScore ?? 0,
      maxScore: ws?.maxScore ?? paperInput.maxScore,
      level: `${teachers.map((t) => t.name).join(' + ')} 联合评定`,
      dimensions: dims,
      criticalIssues: issues.slice(0, 6),
      minorIssues: issues.slice(6),
      highlights: results.flatMap((r) => r.highlights || []),
      summary: results.map((r) => `${TEACHERS[r.teacherId]?.name}：${r.summary || ''}`).join('\n\n'),
      suggestions: results.flatMap((r) => r.suggestions || []).slice(0, 8),
      roundtableNote: `双老师联合批改，加权计分（${ws?.breakdown
        .map((b) => `${b.name}×${b.weight}`)
        .join('，')}）`,
      weighted: ws,
      // 归并去重并按标准对齐（详见 utils/grading/keyPoints.js 顶部说明）
      keyPoints: mergeKeyPoints(results, stdInfo.standard),
    }
    return finish()
  }

  // ---------- 三人及以上：圆桌合议 ----------
  const needDebate = dispute.disputed
  const debateResult = needDebate ? await debate(results, paper, { onProgress, signal, taskId, facts }) : null
  output.debate = debateResult
  onProgress?.({ type: 'debate:done', debate: debateResult })

  const fusion = await fuse(results, debateResult, paper, { onProgress, signal, taskId, facts })
  output.fusion = fusion

  const ws = weightedScore(results, teachers)
  output.final = {
    finalScore: fusion?.finalScore ?? ws?.finalScore ?? 0,
    maxScore: fusion?.maxScore || paperInput.maxScore,
    level: fusion?.level || joinLevels(results) || '圆桌合议结论',
    dimensions: fusion?.dimensions || [],
    criticalIssues: fusion?.criticalIssues || [],
    minorIssues: fusion?.minorIssues || [],
    highlights: fusion?.highlights || [],
    summary: fusion?.summary || '',
    suggestions: fusion?.suggestions || [],
    roundtableNote:
      fusion?.roundtableNote ||
      `${teachers.length} 位老师圆桌合议${needDebate ? '（含分歧复核）' : '（评分一致，未触发辩论）'}`,
    weighted: ws,
    // 归并去重并按标准对齐（详见 utils/grading/keyPoints.js 顶部说明）
    keyPoints: mergeKeyPoints(results, stdInfo.standard),
  }
  if (!fusion) {
    output.final.errorNote = '合议结果解析失败，已回退为加权计分'
  }

  return finish()
}
