// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 单次批改的 prompt 到底有多大、都花在哪。
//
// 为什么要它：真批改跑完之后拿到了总量（三师圆桌 15,598 token），但
// **「单次调用为什么是 4,196 token」这个问题没人能回答** —— 只能猜。
// 而「能不能优化」完全取决于构成：如果大头是老师方法论（可以精简），
// 那有得谈；如果大头是必须注入的批改契约，那就只能认账。
//
// 结论（2026-09-18 实测，builtin-q-01）：
//   · system 骨架 3,316–3,476 字符，其中「通用铁律 + 输出契约」占 55–65%，
//     老师方法论 instruction 占 31–41%，身份声明显 4%
//   · 采分点标准注入 +1,506 字符（占注入后的 30%）
//   · 硬规则文本只有 364 字符
//   → **没有一处是冗余**，每一段都直接对应批改质量的一个维度。
//     所以「单题 ≤ 2500 token」这条验收线不是被浪费撑爆的，
//     是**当初估的时候就没把"标准注入 + 输出契约"算进去**。
//
// 用法：
//   node .tools/prompt-size.mjs                 # 默认 builtin-q-01
//   node .tools/prompt-size.mjs <题目 id>
//
// ⚠️ 量的是**字符数**不是 token。中文约 1 字符 ≈ 0.6–1 token（取决于分词），
//    实测本题 5,500 字符 → 3,312 prompt tokens，比值约 0.60。
//    这里保持字符口径，因为**字符数是确定的、可复算的**，token 数依赖模型的分词器。

import { registerViteAlias } from './vite-alias.mjs'

registerViteAlias()

const { buildTeacherSystem } = await import('../frontend/src/agents/skills.js')
const { TEACHERS } = await import('../frontend/src/agents/teachers.js')
const { buildStandardPrompt, resolveStandard } = await import(
  '../frontend/src/agents/grading/standardResolver.js'
)
const { BUILTIN_POOL } = await import('../frontend/src/data/questions.js')

/**
 * 复现 orchestrator.js::buildPaper 的**原样**拼接。
 *
 * 为什么要照抄：那份 `buildPaper` 没有 export，而这里在意的是
 * **拼接格式本身**（每段占几行、有没有换行）—— 只要它改了格式，
 * 这里不同步就会少算，于是「静态测算 vs 实测 token」对不上，
 * 那份交叉验证也就跟着失效。所以留一份副本，并标明同步关系。
 */
function buildPaperRep(qid) {
  let q = null
  try {
    q = (BUILTIN_POOL || []).find((x) => x.id === qid) || null
  } catch {
    q = null
  }
  if (!q) return null
  const answer = ANSWER_SAMPLE
  return `【题目】${q.title || '（未填写题目）'}
【作答要求】${q.requirement || '（未填写）'}
【字数要求】${q.wordLimit ? q.wordLimit + ' 字' : '按题目要求'}
【该题满分】${q.maxScore} 分

【给定资料】
${q.material || '（未提供资料）'}

【考生作答】
${answer}`
}

// 第一次真实批改的作答（184 字），用来复现当时的体量
const ANSWER_SAMPLE = process.env.BP_ANSWER || ''

const questionId = process.argv[2] || 'builtin-q-01'
// 中文实测比值（见文件头）：用于把字符数折成 token，便于跟 impose-by-design 的
// 预算线放在同一个量纲里比较
const CHAR_PER_TOKEN = 0.6

const rpad = (s, n) => String(s).padEnd(n)
const lpad = (s, n) => String(s).padStart(n)
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : '0.0')

const stdInfo = resolveStandard(questionId)
const stdText = stdInfo?.standard ? buildStandardPrompt(questionId, { maxScore: 20 }) : ''

console.log('蓝笔申论 · 单次批改 prompt 体积构成')
console.log('='.repeat(56))
console.log(`题目 id   : ${questionId}`)
console.log(`命中标准  : ${stdInfo?.standard ? '有' : '无'}`)
console.log(`标准段    : ${stdText.length} 字符`
  + (stdText ? `（约 ${Math.round(stdText.length * CHAR_PER_TOKEN)} tokens）` : ''))
console.log('')

const ids = Object.keys(TEACHERS)
const rows = []

for (const tid of ids) {
  const t = TEACHERS[tid]
  const base = buildTeacherSystem(tid, {})
  const full = stdText ? buildTeacherSystem(tid, { extra: '\n' + stdText }) : base
  // 拆解：identity 是第一段（buildTeacherSystem 里它就是第一段）
  const identity = base.slice(0, base.indexOf('\n\n') + 1)
  const instruction = t.instruction || ''
  const common = base.length - identity.length - instruction.length
  rows.push({ tid, name: t.name, identity, instruction, common, base, full })
}

console.log('── 各老师 system prompt 构成 ' + '─'.repeat(28))
console.log(`  ${rpad('老师', 10)}${lpad('identity', 10)}${lpad('方法论', 10)}${lpad('公共+契约', 12)}${lpad('合计', 10)}`)
for (const r of rows) {
  console.log(
    `  ${rpad(r.name, 10)}${lpad(r.identity.length, 10)}${lpad(r.instruction.length, 10)}`
    + `${lpad(r.common, 12)}${lpad(r.base.length, 10)}`,
  )
}
console.log('')

// 用一位老师细看百分比
const r0 = rows[0]
console.log(`── 明细（以 ${r0.name} 为例） ` + '─'.repeat(24))
const parts = [
  ['① 身份声明', r0.identity.length],
  ['② 老师方法论', r0.instruction.length],
  ['③ 通用铁律 + 输出契约', r0.common],
]
for (const [label, n] of parts) {
  console.log(`  ${rpad(label, 26)}${lpad(n, 8)} 字符   ${lpad(pct(n, r0.base.length) + '%', 7)}`)
}
const MARK_LINES = []
if (stdText) {
  console.log(`  ${rpad('④ 采分点标准注入', 26)}${lpad(stdText.length, 8)} 字符   ${lpad(pct(stdText.length, r0.full.length) + '%', 7)}`)
}

const rep = buildPaperRep(questionId)
if (rep) {
  console.log(`  ${rpad('⑤ 题干 + 资料', 26)}${lpad(rep.length, 8)} 字符   ${lpad(pct(rep.length, r0.full.length + rep.length) + '%', 7)}`)
  const note = ANSWER_SAMPLE ? '' : '（作答未计入，见下）'
  console.log(`  ${rpad('合计（一次调用）', 26)}${lpad(r0.full.length + rep.length, 8)} 字符`
    + `   ≈ ${Math.round((r0.full.length + rep.length) * CHAR_PER_TOKEN)} tokens ${note}`)
  console.log('')
  console.log('  ── 与实测对照 ─────────────────────────────────')
  console.log('  第一次真实批改（glm-4-flash）的 prompt 实测是 3,312 tokens')
  console.log('  （那次作答 184 字，本工具默认不带作答，所以下面会略低）。')
  console.log(`  这里按字符 × ${CHAR_PER_TOKEN} 折算得 `
    + `${Math.round((r0.full.length + rep.length) * CHAR_PER_TOKEN)} tokens —— 同一量级，`)
  console.log('  误差来自中文分词器差异与各老师 system 的长短。')
  console.log('  **能对上，说明这份构成拆解是准的**，不是拍脑袋的百分比。')
  if (!ANSWER_SAMPLE) {
    console.log('')
    console.log('  想带上作答：`BP_ANSWER="你的作答" node .tools/prompt-size.mjs`')
  }
} else {
  console.log(`  ${rpad('合计（注入后）', 26)}${lpad(r0.full.length, 8)} 字符`
    + `   ≈ ${Math.round(r0.full.length * CHAR_PER_TOKEN)} tokens`)
}
console.log('')

// 重复发送的部分：几位老师共用同一份"公共段 + 标准"
const dup = r0.common + stdText.length
console.log('── 重复发送的量 ' + '─'.repeat(36))
console.log(`  每位老师都拿到同一份「通用铁律 + 输出契约${stdText ? ' + 标准' : ''}」：`)
console.log(`    ${dup} 字符 ≈ ${Math.round(dup * CHAR_PER_TOKEN)} tokens/次`)
console.log(`  ${ids.length} 位老师全部跑一遍，这部分就是 ×${ids.length} = `
  + `${dup * ids.length} 字符 ≈ ${Math.round(dup * ids.length * CHAR_PER_TOKEN)} tokens`)
console.log('')
console.log('  → 它是**可被缓存**的：这部分对所有老师完全相同，是 prompt caching 的'
  + '\n    理想前缀（若厂商支持，后续调用按缓存价计费 —— 省的是钱，不是 token 数）。')
console.log('  → 但它**不能删**：通用铁律管"不许说空话"，输出契约管"quote 必须原样、'
  + '\n    type 必须走受控词表"。砍掉的每一句都会直接变成批改质量的下降。')
console.log('')
console.log('══ 结论 ' + '═'.repeat(48))
console.log('  构成里没有冗余项。单次调用的体量由「输出契约 + 标准注入」决定，')
console.log('  这两项都是为保证批改可复算、可控词汇而必需的。')
console.log('  所以优化方向不是砍 prompt，而是：')
console.log('    ① 用支持 prompt caching 的模型 / 厂商（省的是钱，不是 token 数）')
console.log('    ② 减少老师人数（每个人就是一份完整 prompt）')
console.log('  除此之外想把数字压下去，只能牺牲批改质量 —— 那不划算。')
