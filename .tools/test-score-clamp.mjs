// ──────────────────────────────────────────────────────────────
// 蓝笔申论 · 最终分钳制护栏测试
//   node .tools/test-score-clamp.mjs
//
// 两层：
//   A. scoreGuard.js 纯函数单测（越界/负数/NaN/满分缺失回退/维度钳制）
//   B. 源码直读护栏（防回归）：orchestrator finish() 必须调用钳制，
//      且在 assessCredibility 之前；FUSION_SCHEMA 必须声明分数红线。
//
// 背景：合议 LLM 曾在 20 分题输出 66 分 → 统计页 330% 得分率。
// ──────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { clampFinalScore, clampDimensions } = await import(
  pathToFileURL(path.resolve(ROOT, 'frontend/src/utils/grading/scoreGuard.js')).href
)

let pass = 0
let fail = 0
const cases = []
function t(name, cond) {
  cases.push({ name, ok: !!cond })
  if (cond) pass++
  else fail++
}

// ---------- A. 纯函数单测 ----------
{
  const r = clampFinalScore({ finalScore: 66, maxScore: 20 }, 20)
  t('A1 越界上钳：66/20 → 20', r.finalScore === 20 && r.clamped === true && r.maxScore === 20)
}
{
  const r = clampFinalScore({ finalScore: -3, maxScore: 20 }, 20)
  t('A2 负分下钳：-3 → 0', r.finalScore === 0 && r.clamped === true)
}
{
  const r = clampFinalScore({ finalScore: 12.5, maxScore: 20 }, 20)
  t('A3 正常分原样通过，clamped=false', r.finalScore === 12.5 && r.clamped === false)
}
{
  const r = clampFinalScore({ finalScore: '66', maxScore: 20 }, 20)
  t('A4 数字字符串转数值后钳制', r.finalScore === 20 && r.clamped === true)
}
{
  const r = clampFinalScore({ finalScore: NaN, maxScore: 20 }, 20)
  t('A5 NaN → 0 且视为被钳', r.finalScore === 0 && r.clamped === true)
}
{
  const r = clampFinalScore({ finalScore: 66, maxScore: 100 }, 20)
  t('A6 权威满分优先：fallback 20 压过 final.maxScore=100', r.finalScore === 20 && r.maxScore === 20)
}
{
  const r = clampFinalScore({ finalScore: 66, maxScore: 20 }, 0)
  t('A7 权威缺失回退 final.maxScore=20', r.finalScore === 20 && r.maxScore === 20)
}
{
  const r = clampFinalScore({ finalScore: 66, maxScore: 0 }, 0)
  t('A8 满分无效无从钳制，原样返回不误伤', r.finalScore === 66 && r.clamped === false)
}
{
  const r = clampFinalScore(null, 20)
  t('A9 final 为 null 不抛异常', r.finalScore === 0 && r.clamped === true)
}
{
  const dims = [
    { name: 'a', score: 8, max: 5 },
    { name: 'b', score: -2, max: 5 },
    { name: 'c', score: 3, max: 5 },
  ]
  const changed = clampDimensions(dims)
  t('A10 维度钳制：8/5→5，-2→0，3 不动', changed && dims[0].score === 5 && dims[1].score === 0 && dims[2].score === 3)
}

// ---------- B. 源码直读护栏（防回归） ----------
const orchSrc = readFileSync(path.resolve(ROOT, 'frontend/src/agents/orchestrator.js'), 'utf8')
t('B1 orchestrator 已 import scoreGuard', orchSrc.includes("from '../utils/grading/scoreGuard'"))
const finishIdx = orchSrc.indexOf('const finish = () =>')
const credIdx = orchSrc.indexOf('assessCredibility({', finishIdx)
const clampIdx = orchSrc.indexOf('clampFinalScore(output.final', finishIdx)
t('B2 finish() 内调用 clampFinalScore', finishIdx >= 0 && clampIdx > finishIdx)
t('B3 钳制发生在 assessCredibility 之前（可信度基于钳后分数）', clampIdx > 0 && credIdx > clampIdx)
t('B4 维度钳制也在位', orchSrc.includes('clampDimensions(output.final.dimensions)'))

const skillsSrc = readFileSync(path.resolve(ROOT, 'frontend/src/agents/skills.js'), 'utf8')
const schemaIdx = skillsSrc.indexOf('export const FUSION_SCHEMA')
const sysIdx = skillsSrc.indexOf('export const FUSION_SYSTEM')
t('B5 FUSION_SCHEMA 声明分数红线（≤满分）', schemaIdx >= 0 && /finalScore 与各分项分必须 ≤ 该题满分/.test(skillsSrc.slice(schemaIdx)))
t('B6 FUSION_SYSTEM 输出要求含分数红线', sysIdx >= 0 && /绝不允许超出/.test(skillsSrc.slice(sysIdx)))

// ---------- 输出 ----------
for (const { name, ok } of cases) {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
}
console.log(`\n${pass}/${cases.length} 通过`)
process.exit(fail ? 1 : 0)
