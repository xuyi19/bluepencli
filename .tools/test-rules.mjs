// 硬规则引擎单测（Node 直跑，无依赖）
//
//   node .tools/test-rules.mjs
//
// 为什么要单独给"纯代码层"写测试：
//   这一层的输出会被当成**客观事实**展示给考生，算错一次就不可信了。
//   而且它最容易在改文案/改阈值时被悄悄改坏——没有断言就没人发现。

import assert from 'node:assert/strict'
import {
  countChars,
  countGrid,
  getStats,
  runHardRules,
  formatRulesForPrompt,
  DEDUCTION_CAP_RATIO,
} from '../frontend/src/utils/grading/rules.js'

let pass = 0
const fails = []
function t(name, fn) {
  try {
    fn()
    pass++
  } catch (e) {
    fails.push({ name, msg: e.message })
  }
}

const ids = (rules) => rules.findings.map((f) => f.id)
const has = (rules, id) => ids(rules).includes(id)

// ── 基础统计 ──
t('countChars 不计空白、含标点', () => {
  assert.equal(countChars('你好，世界。'), 6)
  assert.equal(countChars(' 你 好 \n 世 界 '), 4)
  assert.equal(countChars(''), 0)
  assert.equal(countChars(null), 0)
})

t('countGrid 半角算半格', () => {
  assert.equal(countGrid('你好'), 2)
  assert.equal(countGrid('你好2024'), 4) // 2 + 4*0.5
})

t('getStats 段落/句子/超字比例', () => {
  const s = getStats('第一段。\n第二段。', 4)
  assert.equal(s.paragraphs, 2)
  assert.equal(s.sentences, 2)
  assert.equal(s.chars, 8)
  assert.equal(s.overRatio, 1)
})

// ── 字数 ──
t('超字数：轻微不扣分', () => {
  const r = runHardRules({ answer: '一'.repeat(101), wordLimit: 100, maxScore: 20 })
  assert.ok(has(r, 'word-over'))
  const f = r.findings.find((x) => x.id === 'word-over')
  assert.equal(f.level, 'minor')
  assert.equal(f.deduction, 0)
})

t('超字数：>10% 判 fatal 且扣 2', () => {
  const r = runHardRules({ answer: '一'.repeat(120), wordLimit: 100, maxScore: 20 })
  const f = r.findings.find((x) => x.id === 'word-over')
  assert.equal(f.level, 'fatal')
  assert.equal(f.deduction, 2)
})

t('字数不足：>30% 判 fatal', () => {
  const r = runHardRules({ answer: '一'.repeat(60), wordLimit: 100, maxScore: 20 })
  const f = r.findings.find((x) => x.id === 'word-under')
  assert.equal(f.level, 'fatal')
  assert.equal(f.overlapWith, '采分点缺失')
})

t('字数刚好：给 word-fit 且不扣分', () => {
  const r = runHardRules({ answer: '一'.repeat(100), wordLimit: 100, maxScore: 20 })
  assert.ok(has(r, 'word-fit'))
  assert.equal(r.findings.find((x) => x.id === 'word-fit').deduction, 0)
})

t('无 wordLimit 时不产生字数结论', () => {
  const r = runHardRules({ answer: '随便写一点内容', maxScore: 20 })
  assert.ok(!has(r, 'word-over') && !has(r, 'word-under') && !has(r, 'word-fit'))
})

// ── 标点 ──
t('半角标点夹汉字能被抓到', () => {
  const r = runHardRules({ answer: '我们要重视,而且要落实.' })
  assert.ok(has(r, 'punct-halfwidth'))
})

t('小数/百分比不误报半角标点', () => {
  const r = runHardRules({ answer: '增长了3.2个百分点，达到100%' })
  // 「3.2」「100%」里的点号前后不夹汉字，属于合法用法
  const f = r.findings.find((x) => x.id === 'punct-halfwidth')
  assert.ok(!f, '不应把 3.2/100% 里的点号判成中文半角混用')
})

t('连续标点被抓到，省略号不算', () => {
  const r = runHardRules({ answer: '他说：“这事没完。。”然后离开了……' })
  assert.ok(has(r, 'punct-repeat'))
  const f = r.findings.find((x) => x.id === 'punct-repeat')
  assert.ok(!f.evidence.includes('……'))
})

t('结尾缺标点', () => {
  const r = runHardRules({ answer: '这是一句没有结束标点的表述' })
  assert.ok(has(r, 'punct-tail'))
})

// ── 结构 ──
t('长文单段判未分段', () => {
  const r = runHardRules({ answer: '一'.repeat(200), type: '归纳概括' })
  assert.ok(has(r, 'struct-nopara'))
})

t('归纳概括无序号判该分条未分条', () => {
  const r = runHardRules({
    answer: '我们要加强领导。\n同时重视投入。\n还要完善机制。\n' + '内容'.repeat(60),
    type: '归纳概括',
  })
  assert.ok(has(r, 'struct-noitems'))
})

t('有序号时不再报未分条', () => {
  const r = runHardRules({
    answer: '一是加强领导。\n二是重视投入。\n三是完善机制。\n' + '内容'.repeat(60),
    type: '归纳概括',
  })
  assert.ok(!has(r, 'struct-noitems'))
})

// ── 重复 / 照抄 ──
t('整句重复', () => {
  const s = '我们要加强基层治理能力建设。'
  const r = runHardRules({ answer: s + s })
  assert.ok(has(r, 'dup-sentence'))
})

t('照抄材料 ≥15 字被判 fatal', () => {
  const material = '数字乡村建设三年行动把数字技术作为缩小城乡差距的重要抓手全面推进'
  const r = runHardRules({ answer: '答：' + material.slice(0, 20) + '。', material })
  assert.ok(has(r, 'copy-material'))
  assert.equal(r.findings.find((x) => x.id === 'copy-material').level, 'fatal')
})

t('正常概括不误报照抄', () => {
  const material = '数字乡村建设三年行动把数字技术作为缩小城乡差距的重要抓手全面推进'
  const r = runHardRules({ answer: '成立领导小组、设立专项资金、建立评价指标、推进农业数字化。' , material })
  assert.ok(!has(r, 'copy-material'))
})

t('抄题干被判 copy-requirement', () => {
  const requirement = '请根据给定资料概括主要做法，全面准确有条理'
  const r = runHardRules({ answer: '请根据给定资料概括主要做法：一是……' , requirement })
  assert.ok(has(r, 'copy-requirement'))
})

// ── 聚合 ──
t('空作答只有一条 fatal', () => {
  const r = runHardRules({ answer: '   ', maxScore: 20 })
  assert.equal(r.findings.length, 1)
  assert.equal(r.findings[0].id, 'empty')
})

t('客观扣分封顶为满分 20%', () => {
  const material = '数字乡村建设三年行动把数字技术作为缩小城乡差距的重要抓手全面推进'
  const r = runHardRules({
    answer: material + '。' + '重复句内容不少于十个字。'.repeat(2),
    wordLimit: 50,
    maxScore: 20,
    material,
  })
  assert.equal(r.cap, Math.round(20 * DEDUCTION_CAP_RATIO))
  assert.ok(r.rawDeduction > r.cap, `预期 raw(${r.rawDeduction}) > cap(${r.cap})`)
  assert.equal(r.objectiveDeduction, r.cap)
  assert.equal(r.capped, true)
})

t('findings 按严重度降序', () => {
  const r = runHardRules({ answer: '我们要重视,而且要落实。\n' + '一'.repeat(200), wordLimit: 100, maxScore: 20, type: '归纳概括' })
  const w = r.findings.map((f) => ({ fatal: 3, major: 2, minor: 1 })[f.level])
  assert.deepEqual(w, [...w].sort((a, b) => b - a))
})

t('formatRulesForPrompt 输出含关键事实', () => {
  const r = runHardRules({ answer: '一'.repeat(120), wordLimit: 100, maxScore: 20 })
  const s = formatRulesForPrompt(r)
  assert.ok(s.includes('客观校验结果'))
  assert.ok(s.includes('120'))
  assert.ok(s.includes('勿重复扣分'))
})

t('formatRulesForPrompt 对空结果返回空串', () => {
  assert.equal(formatRulesForPrompt(null), '')
})

// ── 结果 ──
console.log(`\n硬规则引擎单测：${pass} passed, ${fails.length} failed`)
for (const f of fails) console.log(`  ✗ ${f.name}\n    ${f.msg}`)
process.exit(fails.length ? 1 : 0)
