// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 评分可信度的测试。
//
// 和 report-cost / probe-tauri-render 一样，这里守的不是"代码能跑"，而是**不许说假话**：
//
//   ① **没依据必须闭嘴** —— 单人批改算不出一致性，就必须显示「不适用」。
//      把它显示成"分歧 0 个百分点·完美一致"，是本模块最可能出现的假信号，
//      与本项目复发多次的「假绿」同病（看着像通过，其实没测到任何东西）。
//   ② **破坏性事件必须降级** —— 有老师解析失败、客观扣分被封顶，
//      这些都不能因为"别的信号都很好"就被吃掉。
//   ③ **分数与等级必须自洽** —— score 85 分会显示"可信度高"，就不能同时等级是"中"。
//   ④ **判据不能与流水线漂移** —— spreadBadPct 必须等于 orchestrator 的 DISPUTE_THRESHOLD，
//      否则会出现"报告说有分歧、可信度说很一致"的自相矛盾。
//
// 用法：node .tools/test-credibility.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import {
  assessCredibility,
  credibilityLine,
  CREDIBILITY_VERSION,
  LEVEL,
  SIGNAL_LEVEL,
  THRESHOLDS,
} from '../frontend/src/utils/grading/credibility.js'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `   —— ${detail}` : ''}`)
}

const HERE = dirname(fileURLToPath(import.meta.url))
const sig = (c, id) => (c.signals || []).find((s) => s.id === id) || null

/** 造一个理想批改：三师一致、有标准且吻合、没人掉链子、规则没被封顶 */
function idealReport(over = {}) {
  return {
    mode: 'roundtable',
    results: [
      { teacherId: 'yuandong', score: 17.5, maxScore: 20 },
      { teacherId: 'zhoutairan', score: 18, maxScore: 20 },
      { teacherId: 'bailu', score: 17.5, maxScore: 20 },
    ],
    final: { finalScore: 17.5, maxScore: 20 },
    // 形状与运行时一致：buildStandardComparison 返回 `{ standard: summarizeStandard(…), ...cmp }`，
    // 采分点的来源（manual/llm）在**内层** `standard.standard.source` 上，不在外层
    standard: { standard: { source: 'manual' }, coverage: 85, earned: 17, total: 20 },
    hardRules: { rawDeduction: 1, objectiveDeduction: 1, capped: false },
    debate: null,
    ...over,
  }
}

// ── 一、理想情况 ──────────────────────────────────────────
console.log('')
console.log('── 一、理想情况 ──')

const good = assessCredibility(idealReport())
check('版本号随结果带出', good.version === CREDIBILITY_VERSION, good.version)
check('三师一致 + 与程序粗判吻合 + 无失败 → 可信度高', good.level === LEVEL.HIGH,
  `${good.level} / ${good.score} 分`)
check('一致性信号为 good', sig(good, 'agreement')?.level === SIGNAL_LEVEL.GOOD,
  sig(good, 'agreement')?.valueText || '')
check('吻合度信号为 good', sig(good, 'standardAgreement')?.level === SIGNAL_LEVEL.GOOD,
  sig(good, 'standardAgreement')?.valueText || '')
check('每个信号都带了算法口径（basis）',
  good.signals.every((s) => typeof s.basis === 'string' && s.basis.length >= 10),
  good.signals.map((s) => s.id).join(','))
check('无谓扣分项一个都没有时也不给满分（太好的可信度是过度承诺）',
  good.score === THRESHOLDS.maxScore && good.score < 100, `${good.score} 分`)
check('reasons 列出了支撑等级的依据', good.reasons.length >= 2, good.reasons.join('；'))
check('没有无谓的 caveat', good.caveats.length === 0, good.caveats.join('；'))

// ── 二、不许假装：没有依据时必须闭嘴 ──────────────────────
console.log('')
console.log('── 二、没有依据时必须说「不适用」 ──')

const solo = assessCredibility(idealReport({
  mode: 'solo',
  results: [{ teacherId: 'yuandong', score: 17.5, maxScore: 20 }],
}))
check('单人批改 → 一致性是「不适用」而不是「完美一致」',
  sig(solo, 'agreement')?.level === SIGNAL_LEVEL.NA, JSON.stringify(sig(solo, 'agreement')))
check('单人批改的说明里写清了「不是一致，是没得比」',
  /没得比|无从/.test(sig(solo, 'agreement')?.note || ''))
check('单人 + 无标准 → 至少压到中等，不许显示「可信度高」',
  assessCredibility({
    mode: 'solo',
    results: [{ teacherId: 'a', score: 18, maxScore: 20 }],
    final: { finalScore: 18, maxScore: 20 },
    standard: null,
  }).level !== LEVEL.HIGH)
check('单人 + 有标准 → 可以拿高分（有锚点可比）',
  assessCredibility({
    mode: 'solo',
    results: [{ teacherId: 'a', score: 17.5, maxScore: 20 }],
    final: { finalScore: 17.5, maxScore: 20 },
    // 形状与运行时一致：buildStandardComparison 返回 `{ standard: summarizeStandard(…), ...cmp }`，
    // 采分点的来源（manual/llm）在**内层** `standard.standard.source` 上，不在外层
    standard: { standard: { source: 'manual' }, coverage: 85, earned: 17, total: 20 },
  }).level === LEVEL.HIGH)

const noStd = assessCredibility(idealReport({ standard: null }))
check('没有采分点标准 → 吻合度是「不适用」',
  sig(noStd, 'standardAgreement')?.level === SIGNAL_LEVEL.NA)
check('没有标准时明确告知：这次缺一个独立于模型的旁证',
  noStd.caveats.some((c) => c.includes('没有采分点标准')))

// ── 标准来源（2026-09-24 新增信号 2b）──────────────────────
// 它回答的是"分数准不准"这个最大的短板：同一个模型、同一份作答，
// 背后有没有锚点、锚点校过没校过，可信程度不同。
console.log('')
console.log('── 二·五、标准的来路 ──')

check('人工精校 → 标准来源为「好」，并进入 reasons',
  sig(good, 'standardSource')?.level === SIGNAL_LEVEL.GOOD &&
    good.reasons.some((r) => r.includes('人工精校')),
  sig(good, 'standardSource')?.valueText || '')

check('无标准 → 标准来源为「差」，明确指出是裸判',
  sig(noStd, 'standardSource')?.level === SIGNAL_LEVEL.BAD,
  sig(noStd, 'standardSource')?.valueText || '')

check('无标准 → 等级最多「基本可信」（几位老师一致只能说明模型想法接近，说明不了判得对）',
  noStd.level === LEVEL.MEDIUM, `${noStd.level} / ${noStd.score} 分`)

const draftStd = assessCredibility(
  idealReport({ standard: { standard: { source: 'llm' }, coverage: 85, earned: 17, total: 20 } })
)
check('机器预解析草稿 → 标准来源为「注意」（有尺子但没校过）',
  sig(draftStd, 'standardSource')?.level === SIGNAL_LEVEL.WARN,
  sig(draftStd, 'standardSource')?.valueText || '')
check('机器草稿比人工精校扣分更多',
  draftStd.score < good.score, `${draftStd.score} vs ${good.score}`)
check('每种来源都带了算法口径（basis）',
  ['good', 'noStd', 'draftStd'].every((k) => {
    const c = { good, noStd, draftStd }[k]
    const s = sig(c, 'standardSource')
    return s && typeof s.basis === 'string' && s.basis.length >= 10
  }))

// ── 三、破坏性事件必须降级 ────────────────────────────────
console.log('')
console.log('── 三、掉链子就降级 ──')

const oneFail = assessCredibility(idealReport({
  results: [
    { teacherId: 'a', score: 17.5, maxScore: 20 },
    { teacherId: 'b', score: 18, maxScore: 20 },
    { teacherId: 'c', error: '解析失败', score: 0, maxScore: 0 },
  ],
}))
check('有老师解析失败 → 完成度信号为 bad',
  sig(oneFail, 'completeness')?.level === SIGNAL_LEVEL.BAD)
check('有老师解析失败 → 等级封顶在中等（不给高分）',
  oneFail.level !== LEVEL.HIGH, `${oneFail.level} / ${oneFail.score} 分`)
check('失败写进了降级理由', oneFail.reasons.some((r) => r.includes('解析失败')))

const allFail = assessCredibility(idealReport({
  results: [{ teacherId: 'a', error: '解析失败' }, { teacherId: 'b', error: '解析失败' }],
  final: { finalScore: 0, maxScore: 20 },
}))
check('全部失败 → 无从评估，且分数为 0',
  allFail.level === LEVEL.UNKNOWN && allFail.score === 0, `${allFail.level} / ${allFail.score}`)
check('空批改（没有任何有效成绩）→ 无从评估',
  assessCredibility({ results: [], final: null }).level === LEVEL.UNKNOWN)
check('无从评估时 headline 明说原因', /无从/.test(allFail.headline), allFail.headline)

const capped = assessCredibility(idealReport({
  hardRules: { rawDeduction: 6, objectiveDeduction: 4, capped: true },
}))
check('客观扣分被封顶 → 客观校验信号报警', sig(capped, 'ruleCap')?.level === SIGNAL_LEVEL.WARN)
check('封顶时明说「AI 可能比规则层更宽容」',
  capped.caveats.some((c) => c.includes('宽容')))

// ── 四、分歧判据 ──────────────────────────────────────────
console.log('')
console.log('── 四、分歧判据 ──')

const wideGap = assessCredibility(idealReport({
  results: [
    { teacherId: 'a', score: 18, maxScore: 20 },
    { teacherId: 'b', score: 18, maxScore: 20 },
    { teacherId: 'c', score: 12, maxScore: 20 },
  ],
  dispute: { disputed: true },
}))
check('极差 30 个百分点 → 一致性信号为 bad',
  sig(wideGap, 'agreement')?.level === SIGNAL_LEVEL.BAD, sig(wideGap, 'agreement')?.valueText)
check('大分歧导致明显扣分', wideGap.score < THRESHOLDS.scoreHigh,
  `${wideGap.score} 分 / ${wideGap.level}`)

const oneStep = assessCredibility(idealReport({
  results: [
    { teacherId: 'a', score: 19, maxScore: 20 },
    { teacherId: 'b', score: 18, maxScore: 20 },
    { teacherId: 'c', score: 17.5, maxScore: 20 },
  ],
}))
check('极差 7.5 个百分点 → 落在 warn 档（未触发辩论，但已不一致）',
  sig(oneStep, 'agreement')?.level === SIGNAL_LEVEL.WARN, sig(oneStep, 'agreement')?.valueText)

// 判据漂移护栏：这里的"分歧"必须和流水线里"要不要吵一架"用同一条线，
// 否则会打出「报告说有分歧、可信度说很一致」这种自相矛盾的展示。
const orch = readFileSync(resolve(HERE, '../frontend/src/agents/orchestrator.js'), 'utf8')
const m = orch.match(/DISPUTE_THRESHOLD\s*=\s*([\d.]+)/)
check('判据与 orchestrator 的 DISPUTE_THRESHOLD 一致（改一头必须改两头）',
  !!m && Number(m[1]) * 100 === THRESHOLDS.spreadBadPct,
  m ? `orchestrator ${Number(m[1]) * 100}% vs credibility ${THRESHOLDS.spreadBadPct}%` : '未匹配到')

// 接线护栏：内核再准，没接进流水线也白搭。
// 结果页拿不到 `standard`（标准是 orchestrator 内部注入的），所以可信度必须
// **在批改时算好、随记录存档** —— 这条静态断言不是为了防্যাকা谁删代码，
// 是为了让「改了流水线却没跟着改」这件事在变红时有处可查。
check('流水线确实调用了 assessCredibility',
  /import\s*\{\s*assessCredibility\s*\}/.test(orch))
check('可信度写在 finish() 里（三种模式都会算到，不会单人模式漏掉）',
  /output\.credibility\s*=\s*assessCredibility/.test(orch))

// ── 五、分数与等级自洽 ────────────────────────────────────
console.log('')
console.log('── 五、分数 ↔ 等级必须自洽 ──')

const cases = [
  idealReport(),
  idealReport({ standard: null }),
  idealReport({ results: [{ teacherId: 'a', score: 17.5, maxScore: 20 }], mode: 'solo' }),
  idealReport({ results: [{ teacherId: 'a', error: 'x' }, { teacherId: 'b', score: 18, maxScore: 20 }] }),
  idealReport({
    results: [
      { teacherId: 'a', score: 20, maxScore: 20 },
      { teacherId: 'b', score: 10, maxScore: 20 },
      { teacherId: 'c', score: 11, maxScore: 20 },
    ],
    hardRules: { rawDeduction: 9, objectiveDeduction: 4, capped: true },
    standard: { coverage: 40, earned: 8, total: 20 },
    final: { finalScore: 12, maxScore: 20 },
  }),
]
let consistent = true
let inconsistentAt = ''
for (const c of cases) {
  const r = assessCredibility(c)
  const expect =
    r.score >= THRESHOLDS.scoreHigh ? LEVEL.HIGH : r.score >= THRESHOLDS.scoreMedium ? LEVEL.MEDIUM : LEVEL.LOW
  if (r.level !== LEVEL.UNKNOWN && r.level !== expect) {
    consistent = false
    inconsistentAt = `score ${r.score} → ${r.level}（应为 ${expect}）`
  }
}
check('分数区间与等级一一对应（不会显示 90 分却是"仅供参考"）', consistent, inconsistentAt)

const lowCase = assessCredibility(cases[cases.length - 1])
check('又大分歧又撞封顶又偏离标准 → 落到低档',
  lowCase.level === LEVEL.LOW, `${lowCase.level} / ${lowCase.score} 分`)
check('低档时给出「仅供参考」的措辞', /仅供参考/.test(lowCase.headline), lowCase.headline)

// ── 六、真数据订住 ────────────────────────────────────────
console.log('')
console.log('── 六、真数据订住 ──')
// 2026-09-17 那次真实批改：任务 mu68na1iptf4fr（三师圆桌 / 智谱 glm-4-flash）
//   数据库可复核：release/桌面版/历史版本/蓝笔申论-桌面版-v0.13.3/data/bluepencil.db
//   grading_tasks：mode=trio, final_score=17.5, max_score=20, disputed=0
//   程序按标准粗判覆盖率 85%（17/20）
// 这两条数互不相干地指向同一个地方，是可信度模块存在的直接动因。
const real = assessCredibility({
  mode: 'roundtable',
  results: [
    { teacherId: 'yuandong', score: 17.5, maxScore: 20 },
    { teacherId: 'zhoutairan', score: 17.5, maxScore: 20 },
    { teacherId: 'bailu', score: 17.5, maxScore: 20 },
  ],
  final: { finalScore: 17.5, maxScore: 20 },
  standard: { coverage: 85, earned: 17, total: 20 },
})
check('真数据：终评 87.5% vs 程序粗判 85%，差 2.5 个百分点',
  /2\.5 个百分点/.test(sig(real, 'standardAgreement')?.valueText || ''),
  sig(real, 'standardAgreement')?.valueText)
check('真数据：两个独立口径互相印证 → 判为可信度高', real.level === LEVEL.HIGH,
  `${real.level} / ${real.score} 分`)
// ── 七、列表页一行版 ──────────────────────────────────────
console.log('')
console.log('── 七、一行版摘要 ──')
check('一行版带上等级与分数', /可信度高·/.test(credibilityLine(good)), credibilityLine(good))
check('一行版带上最关键的那条理由', /位老师的判断基本一致/.test(credibilityLine(good)))
check('无从评估时一行版返回空串（列表页不显示就是了）',
  credibilityLine(allFail) === '' && credibilityLine(null) === '')

// ── 收尾 ─────────────────────────────────────────────────
console.log('')
const failed = results.filter((r) => !r.ok)
console.log(`评分可信度测试：${results.length - failed.length} passed, ${failed.length} failed`)
if (failed.length) console.log('未通过：' + failed.map((f) => f.name).join(' / '))
process.exit(failed.length ? 1 : 0)
