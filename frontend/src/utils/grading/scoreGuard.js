/**
 * 最终分钳制 —— 不信任 LLM 输出的最后一道闸。
 *
 * 背景（v0.17.0 实锤）：三人圆桌模式下，合议阶段 LLM 在一道 20 分题上
 * 输出了 finalScore=66，orchestrator 直接采信写进记录 → 统计页出现 330% 得分率。
 * prompt 约束（见 agents/skills.js FUSION_SCHEMA）能降低概率但拦不住全部，
 * 所以代码层必须在写档前硬钳制。
 *
 * 口径：满分以调用方传入的 maxScore 为权威（paper 由本地构建，含【该题满分】），
 * 合议返回的 maxScore 只作 fallback，不允许改写满分。
 */

/**
 * 钳制最终分到 [0, maxScore]。
 * @param {object} final orchestrator 的 output.final（含 finalScore / maxScore）
 * @param {number} fallbackMax 权威满分（paperInput.maxScore），缺失时退回 final.maxScore
 * @returns {{ finalScore: number, maxScore: number, clamped: boolean }}
 *   clamped=true 表示发生过钳制（调用方可记录日志/标记）
 */
export function clampFinalScore(final, fallbackMax = 0) {
  const maxRaw = Number(fallbackMax) > 0 ? Number(fallbackMax) : Number(final?.maxScore) || 0
  const raw = Number(final?.finalScore)
  // 分数不是有限数字：置 0，同样视为被钳
  if (!Number.isFinite(raw)) {
    return { finalScore: 0, maxScore: maxRaw, clamped: true }
  }
  // 满分本身无效：无从钳制，原样返回（不该发生，防御而已）
  if (maxRaw <= 0) {
    return { finalScore: raw, maxScore: maxRaw, clamped: false }
  }
  const clamped = Math.max(0, Math.min(raw, maxRaw))
  return { finalScore: clamped, maxScore: maxRaw, clamped: clamped !== raw }
}

/**
 * 钳制分项维度分数（dimensions[].score 不得超出对应 max）。
 * 直接在原对象上改写，返回是否发生过改动。
 * @param {Array<{score:number,max:number}>} dimensions
 */
export function clampDimensions(dimensions) {
  let changed = false
  for (const d of dimensions || []) {
    const max = Number(d?.max) || 0
    const s = Number(d?.score)
    if (Number.isFinite(s) && max > 0 && (s < 0 || s > max)) {
      d.score = Math.max(0, Math.min(s, max))
      changed = true
    }
  }
  return changed
}
