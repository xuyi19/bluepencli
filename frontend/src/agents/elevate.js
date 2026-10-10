// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 升格引擎 · 调用包装（薄层）：组装上下文 → 单次 chat → 解析校验。
// 纯逻辑全部在 utils/grading/elevation.js（Node 可直测），这里只做接线。

import { chat } from '../api/llm'
import { parseJson } from '../utils/parse'
import { trimMaterial } from '../utils/grading/materialTrim'
import { buildStandardPrompt } from './grading/standardResolver'
import {
  buildElevateMessages,
  buildGradingDigest,
  validateElevation,
  ELEVATE_VERSION,
} from '../utils/grading/elevation'

/**
 * 生成升格对照。批改完成后按需调用（结果页按钮），一次 LLM 调用。
 *
 * @param {object} rec 规范化记录（canonical record，见 record.js ensureCanonical）
 *   用到的字段：title/requirement/answer/material/wordLimit/maxScore/questionId
 *   finalScore/maxScore/level/keyPoints/criticalIssues
 * @param {object} opts { signal, onDelta }
 * @returns {Promise<{ elevation, problems, version }>} elevation 已过校验（可能为 null）
 */
export async function runElevation(rec, { signal, onDelta } = {}) {
  if (!rec?.answer) throw new Error('没有作答内容，无法生成升格对照')

  // 材料是大头：升格不需要整卷材料，与练习页同款裁剪规矩（stem 口径同 applyTrim）
  const stem = [rec.title, rec.requirement].filter(Boolean).join(' ')
  const material = trimMaterial(rec.material || '', stem)

  const messages = buildElevateMessages({
    title: rec.title || '',
    requirement: rec.requirement || '',
    answer: rec.answer || '',
    material,
    wordLimit: rec.wordLimit ?? null,
    maxScore: rec.maxScore || 0,
    gradingDigest: buildGradingDigest(rec, rec.keyPoints, rec.criticalIssues),
    standardPrompt: buildStandardPrompt(rec.questionId, { maxScore: rec.maxScore || 0 }),
  })

  const text = await chat({
    messages: [
      { role: 'system', content: messages.system },
      { role: 'user', content: messages.user },
    ],
    stream: true,
    signal,
    temperature: 0.2,
    meta: { stage: 'elevate' },
    onDelta: (_d, full) => onDelta?.(full),
  })

  const parsed = parseJson(text)
  return { ...validateElevation(parsed, rec.answer || ''), version: ELEVATE_VERSION }
}
