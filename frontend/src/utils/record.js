// 练习记录的规范化与读写
//
// 同一份记录会同时活在两个地方：
//   1. 浏览器 IndexedDB —— 离线与单文件版唯一可用的存储
//   2. 后端 docs/practice/ —— 落成 md + json，可跨浏览器、能直接用编辑器翻
//
// 两边字段命名不同（后端是 snake_case），这里统一收敛成「规范记录」（canonical），
// 于是上层 UI 只需要面对一种数据结构。
//
// 读取策略是**合并**而不是二选一：某些记录只存在于本地（当时后端没开），
// 某些只存在于 docs（在另一个端口/浏览器里练的），按 id 去重后一起展示。

import { getAll, put, remove, STORES } from '../store/db'
import {
  saveRecordFile,
  listRecordFiles,
  getRecordFile,
  deleteRecordFile,
  fetchRecordMarkdown,
} from '../api/backend'
import { TEACHERS } from '../agents/teachers'
// 读档归一化：历史脏记录（LLM 越界分，实测合议在 20 分题输出 66）读取时钳回满分内
import { clampFinalScore } from './grading/scoreGuard'

export function countChars(s) {
  return String(s || '').replace(/\s/g, '').length
}

/** 读档兜底：finalScore 钳到 [0, maxScore]，满分缺失回退 40（与写入口径一致）。 */
function sanitizeScore(rec) {
  if (!rec) return rec
  const { finalScore, maxScore } = clampFinalScore(rec, Number(rec.maxScore) || 40)
  rec.finalScore = finalScore
  rec.maxScore = maxScore
  return rec
}

function teacherMeta(id) {
  const t = TEACHERS[id]
  if (!t) return { id, name: id }
  return {
    id: t.id,
    name: t.name,
    title: t.title,
    color: t.color,
    avatar: t.avatar,
    focus: t.focus,
    school: t.school,
  }
}

function pad(n) {
  return String(n).padStart(2, '0')
}

export function fmtDateTime(ts) {
  const d = new Date(Number(ts) || 0)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function parseDateTime(text) {
  // 后端存的是 "2026-09-11 21:50:00"，Safari 对空格分隔不认，换成 T
  const t = Date.parse(String(text || '').replace(' ', 'T'))
  return Number.isNaN(t) ? 0 : t
}

// ---------------- 构建规范记录 ----------------

/**
 * 从一次批改结果构建规范记录。
 *
 * `questionType` 是后加的字段（v0.13.3）。加它的原因很具体：
 * 「再练一题」要按短板**找同题型的题**，而记录里原本只有标题和材料，
 * 题型只活在练习页的 UI 状态里，批改完就丢了 —— 于是有这个字段。
 *
 * 老记录没有这个字段，读的地方一律按空串处理（`byQuestionType` 会跳过），
 * 不能拿标题去猜题型：标题里出现「概括」两个字，题不一定就是归纳概括题。
 */
export function buildRecord({ form, report, elapsedMs }) {
  const teacherIds = report.teacherIds || []
  const maxScore = form.maxScore || 40
  // 双保险：orchestrator 出口已钳，写档前再钳一次（历史教训：合议 20 分题输 66 分）
  const finalScore = clampFinalScore({ finalScore: report.final?.finalScore ?? 0, maxScore }, maxScore).finalScore
  return {
    id: report.taskId,
    createdAt: Date.now(),
    title: form.title || '未命名练习',
    questionType: form.questionType || '',
    requirement: form.requirement || '',
    material: form.material || '',
    answer: form.answer || '',
    wordLimit: form.wordLimit ?? null,
    wordCount: countChars(form.answer),
    maxScore,
    mode: report.mode || 'solo',
    teacherIds,
    teachers: teacherIds.map(teacherMeta),
    finalScore,
    level: report.final?.level || '',
    roundtableNote: report.final?.roundtableNote || '',
    summary: report.final?.summary || '',
    suggestions: report.final?.suggestions || [],
    criticalIssues: report.final?.criticalIssues || [],
    minorIssues: report.final?.minorIssues || [],
    highlights: report.final?.highlights || [],
    keyPoints: report.final?.keyPoints || [],
    debate: report.debate || null,
    // 评分可信度：一次批改时算好、随记录一起存档。
    // 为什么要存：三年后翻回这份 md，还能知道"当时这个分数有多少依据"，
    // 而不是只剩一个孤零零的数字。
    credibility: report.credibility || null,
    results: (report.results || []).map((r) => ({
      teacherId: r.teacherId,
      score: r.score,
      maxScore: r.maxScore,
      level: r.level || '',
      summary: r.summary || '',
      advice: r.advice || '',
      annotations: Array.isArray(r.annotations) ? r.annotations : [],
      dimensions: r.dimensions || [],
      deductions: r.deductions || [],
      highlights: r.highlights || [],
      rewrites: r.rewrites || [],
      keyPoints: r.keyPoints || [],
      coverage: r.coverage,
      upgrade: r.upgrade || '',
      error: r.error || '',
    })),
    elapsed: elapsedMs || report.elapsed || 0,
  }
}

// ---------------- 形态转换 ----------------

function toBackend(rec) {
  return {
    id: rec.id,
    created_at: fmtDateTime(rec.createdAt),
    title: rec.title,
    requirement: rec.requirement,
    material: rec.material,
    answer: rec.answer,
    max_score: rec.maxScore,
    word_limit: rec.wordLimit,
    word_count: rec.wordCount,
    mode: rec.mode,
    teacher_ids: rec.teacherIds,
    teachers: rec.teachers,
    final_score: rec.finalScore,
    level: rec.level,
    roundtable_note: rec.roundtableNote,
    summary: rec.summary,
    suggestions: rec.suggestions,
    critical_issues: rec.criticalIssues,
    minor_issues: rec.minorIssues,
    highlights: rec.highlights,
    key_points: rec.keyPoints,
    debate: rec.debate,
    credibility: rec.credibility || null,
    teacher_results: rec.results,
    elapsed_ms: rec.elapsed,
  }
}

function fromBackend(data) {
  const teacherIds = data.teacher_ids || []
  const meta = data.teachers?.length ? data.teachers : teacherIds.map(teacherMeta)
  return sanitizeScore({
    id: data.id,
    createdAt: parseDateTime(data.created_at),
    title: data.title || '未命名练习',
    requirement: data.requirement || '',
    material: data.material || '',
    answer: data.answer || '',
    wordLimit: data.word_limit ?? null,
    wordCount: data.word_count || 0,
    maxScore: data.max_score || 40,
    mode: data.mode || 'solo',
    teacherIds,
    teachers: meta,
    finalScore: data.final_score || 0,
    level: data.level || '',
    roundtableNote: data.roundtable_note || '',
    summary: data.summary || '',
    suggestions: data.suggestions || [],
    criticalIssues: data.critical_issues || [],
    minorIssues: data.minor_issues || [],
    highlights: data.highlights || [],
    keyPoints: data.key_points || [],
    debate: data.debate || null,
    credibility: data.credibility || null,
    results: (data.teacher_results || []).map((r) => ({
      ...r,
      teacherId: r.teacherId || r.teacher_id || '',
      annotations: Array.isArray(r.annotations) ? r.annotations : [],
      advice: r.advice || '',
    })),
    elapsed: data.elapsed_ms || 0,
    source: 'docs',
  })
}

function summaryToCanonical(s) {
  const teacherIds = s.teacher_ids || []
  return sanitizeScore({
    id: s.id,
    createdAt: parseDateTime(s.created_at),
    title: s.title || '未命名练习',
    mode: s.mode || 'solo',
    teacherIds,
    teachers: teacherIds.map(teacherMeta),
    finalScore: s.final_score || 0,
    maxScore: s.max_score || 40,
    level: s.level || '',
    wordCount: s.word_count || 0,
    summary: s.preview || '',
    source: 'docs',
    partial: true, // 摘要，详情需要再拉一次
  })
}

/** 把任意来源的记录统一成规范形态（含旧版字段兼容）。 */
export function ensureCanonical(r) {
  if (!r) return null
  if (r.results || r.finalScore != null) {
    return sanitizeScore({ ...r, createdAt: Number(r.createdAt) || 0, source: r.source || 'local' })
  }
  // 旧版形态：total / teacherResults / deductions
  const teacherIds = r.teacherIds || []
  return sanitizeScore({
    id: r.id,
    createdAt: Number(r.createdAt) || 0,
    title: r.title || '未命名练习',
    questionType: r.questionType || '',
    requirement: r.requirement || '',
    material: r.material || '',
    answer: r.answer || '',
    wordLimit: r.wordLimit ?? null,
    wordCount: r.wordCount || 0,
    maxScore: r.maxScore || 40,
    mode: r.mode || 'solo',
    teacherIds,
    teachers: teacherIds.map(teacherMeta),
    finalScore: r.total || 0,
    level: r.level || '',
    roundtableNote: r.roundtableNote || '',
    summary: r.summary || '',
    suggestions: r.suggestions || [],
    criticalIssues: r.deductions || [],
    minorIssues: r.minorIssues || [],
    highlights: r.highlights || [],
    keyPoints: r.keyPoints || [],
    debate: r.debate || null,
    // 老形态的记录不可能有可信度，落到 null（UI 一律不显示，不猜不算）
    credibility: r.credibility || null,
    results: (r.teacherResults || []).map((t) => ({
      ...t,
      annotations: t.annotations || [],
      advice: t.advice || '',
    })),
    elapsed: r.elapsed || 0,
    source: 'local',
  })
}

// ---------------- 对外读写 ----------------

/**
 * 归档一次练习：本地必写，后端能连上就同时落到 docs/practice/。
 * @returns {Promise<boolean>} 是否成功写入了 docs
 */
export async function archiveRecord(rec) {
  await put(STORES.records, rec)
  const res = await saveRecordFile(toBackend(rec))
  return !!res
}

/** 合并列出：本地 ∪ docs，按 id 去重，时间倒序。 */
export async function listAllRecords() {
  const map = new Map()

  const local = await getAll(STORES.records).catch(() => [])
  for (const raw of local) {
    const rec = ensureCanonical(raw)
    if (rec) map.set(rec.id, rec)
  }

  const remote = (await listRecordFiles()) || []
  for (const s of remote) {
    const prev = map.get(s.id)
    map.set(s.id, {
      ...summaryToCanonical(s),
      ...(prev && !prev.partial ? prev : {}),
      source: prev ? 'both' : 'docs',
      partial: !prev,
    })
  }

  return [...map.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

/** 取单条完整记录：docs 归档优先（更权威），退回本地。 */
export async function loadRecordDetail(id) {
  const remote = await getRecordFile(id)
  if (remote) return fromBackend(remote)

  const local = await getAll(STORES.records).catch(() => [])
  const hit = local.find((r) => r.id === id)
  return hit ? ensureCanonical(hit) : null
}

export async function deleteRecordEverywhere(id) {
  await remove(STORES.records, id).catch(() => {})
  await deleteRecordFile(id)
}

export { fetchRecordMarkdown }
