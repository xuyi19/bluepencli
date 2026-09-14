// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 标准解析器（StandardResolver）
//
// 职责单一：给定题目，回答"有没有标准、是哪一份、要不要注入、注入什么"。
// 批改流程只跟它打交道，不需要知道标准存在哪、是公开还是私有。
//
// 设计原则：**有标准更好，没有标准也要照常批改**。
// 所以这里的每个入口在缺失标准时都必须安全返回，绝不抛错——
// 否则一道没录入标准的题会让整个批改挂掉，那比不批更糟。

import { getStandard } from '../../data/standards/index'
import {
  normalizeStandard,
  validateStandard,
  compareWithStandard,
  formatStandardForPrompt,
  summarizeStandard,
} from './standard'

export { formatStandardForPrompt, compareWithStandard, summarizeStandard }

/**
 * 解析某题的标准。
 * @returns {{ standard: object|null, selfCheck: object|null, source: 'registry'|'none' }}
 */
export function resolveStandard(questionId) {
  const raw = getStandard(questionId)
  if (!raw) return { standard: null, selfCheck: null, source: 'none' }

  const standard = normalizeStandard(raw)
  if (!standard) return { standard: null, selfCheck: null, source: 'none' }

  const check = validateStandard(standard)
  // 标准不合格就当没有——宁可裸判，也不要拿一份自相矛盾的标准去误导阅卷
  if (!check.ok) {
    console.warn(`[standardResolver] 题目 ${questionId} 的采分点标准未通过校验，已忽略：`, check.errors)
    return { standard: null, selfCheck: { ok: false, errors: check.errors }, source: 'none' }
  }
  return { standard, selfCheck: check, source: 'registry' }
}

/**
 * 为某题生成"注入提示词的文本"。
 * 返回空串表示无标准（调用方直接不加），不返回 null 以免调用方还要判空。
 */
export function buildStandardPrompt(questionId, { maxScore = 0 } = {}) {
  const { standard } = resolveStandard(questionId)
  if (!standard) return ''
  return formatStandardForPrompt(standard, { maxScore })
}

/**
 * 生成给结果页展示的对照块：标准 + 逐点覆盖情况（纯代码粗判）。
 * @returns {{ standard, points, earned, total, coverage, hitCount, missCount }|null}
 */
export function buildStandardComparison(questionId, answer) {
  const { standard } = resolveStandard(questionId)
  if (!standard) return null
  const cmp = compareWithStandard(standard, answer)
  if (!cmp) return null
  return { standard: summarizeStandard(standard), ...cmp }
}

/**
 * 汇总一道题的"标准状态"，用于设置页/统计页展示覆盖率。
 */
export function standardStatus(question) {
  const { standard, selfCheck } = resolveStandard(question?.id)
  if (!standard) return { hasStandard: false, valid: false }
  const mismatch =
    question?.maxScore && standard.totalScore && Math.abs(question.maxScore - standard.totalScore) > 0.01
  return {
    hasStandard: true,
    valid: selfCheck?.ok !== false,
    pointCount: standard.points.length,
    source: standard.source,
    // 标准满分与该题满分不一致时要提示——多半是标准录错了
    scoreMismatch: mismatch ? { standard: standard.totalScore, question: question.maxScore } : null,
  }
}
