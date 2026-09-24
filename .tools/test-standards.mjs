// 采分点标准层单测（Node 直跑，无依赖）
//
//   node .tools/test-standards.mjs
//
// 覆盖两块：
//   ① standard.js 的纯逻辑（校验 / 规范化 / 匹配 / 比较 / 提示词）；
//   ② 随仓库发布的 public.js 样板是否**真的合格** —— 这条最重要，
//      因为一份自相矛盾的标准会让批改比没有标准更糟，且很难被发现。

import assert from 'node:assert/strict'
import {
  validateStandard,
  normalizeStandard,
  matchPoint,
  compareWithStandard,
  formatStandardForPrompt,
  POINT_STATUS,
} from '../frontend/src/agents/grading/standard.js'
import { PUBLIC_STANDARDS } from '../frontend/src/data/standards/public.js'

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

const good = () => ({
  questionId: 'x-1',
  totalScore: 10,
  source: 'llm',
  points: [
    { id: 'p1', label: '要点一', weight: 6, evidence: ['材料里的一句话原文够长了吧'], keywords: ['甲', '乙'] },
    { id: 'p2', label: '要点二', weight: 4, evidence: [], keywords: ['丙'] },
  ],
})

// ── 校验 ──
t('合格标准通过校验', () => {
  const r = validateStandard(good())
  assert.equal(r.ok, true, r.errors.join(';'))
  assert.equal(r.pointSum, 10)
})

t('分值之和不等于 totalScore 要报错', () => {
  const s = good()
  s.totalScore = 99
  const r = validateStandard(s)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('不一致')))
})

t('重复 id / 非正 weight / 缺 label 都要报错', () => {
  const s = {
    questionId: 'x',
    points: [
      { id: 'p1', label: '', weight: 0 },
      { id: 'p1', label: '有', weight: -1 },
    ],
  }
  const r = validateStandard(s)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('id 重复')))
  assert.ok(r.errors.some((e) => e.includes('weight')))
  assert.ok(r.errors.some((e) => e.includes('label')))
})

t('非对象/空 points 不崩', () => {
  assert.equal(validateStandard(null).ok, false)
  assert.equal(validateStandard({ questionId: 'x', points: [] }).ok, false)
})

// ── 规范化 ──
t('规范化补默认值并算总分', () => {
  const n = normalizeStandard({
    points: [{ point: '兼容 point 字段', score: 3 }, { label: '两点', weight: 2 }],
  })
  assert.equal(n.totalScore, 5)
  assert.equal(n.points[0].label, '兼容 point 字段')
  assert.equal(n.points[0].id, 'p1')
  assert.deepEqual(n.points[0].evidence, [])
})

t('空标准规范化为 null', () => {
  assert.equal(normalizeStandard(null), null)
  assert.equal(normalizeStandard({ points: [] }), null)
})

// ── 匹配 ──
t('evidence 原文命中 → hit', () => {
  const p = good().points[0]
  const m = matchPoint(p, '这里引用了材料里的一句话原文够长了吧并且甲和乙都写了')
  assert.equal(m.status, POINT_STATUS.HIT)
})

t('只有一半关键词 → partial', () => {
  const p = { id: 'p', label: 'x', weight: 1, evidence: [], keywords: ['甲', '乙', '丙', '丁'] }
  const m = matchPoint(p, '只提到了甲')
  assert.equal(m.status, POINT_STATUS.PARTIAL)
})

t('完全不沾 → miss', () => {
  const p = { id: 'p', label: 'x', weight: 1, evidence: [], keywords: ['甲', '乙'] }
  assert.equal(matchPoint(p, '完全无关的内容').status, POINT_STATUS.MISS)
})

t('空白答案 → miss 不是报错', () => {
  assert.equal(matchPoint(good().points[0], '   ').status, POINT_STATUS.MISS)
})

// ── 比较 ──
t('按分值加权算覆盖率，不被小点凑数', () => {
  const s = {
    questionId: 'x',
    totalScore: 10,
    points: [
      { id: 'p1', label: '大点', weight: 9, evidence: [], keywords: ['甲'] },
      { id: 'p2', label: '小点', weight: 1, evidence: [], keywords: ['乙'] },
    ],
  }
  const c = compareWithStandard(s, '只有乙')
  assert.equal(c.hitCount, 1)
  assert.equal(c.earned, 1)
  assert.equal(c.coverage, 10) // 1/10，而不是 1/2 = 50%
})

t('无 points 的标准比较返回 null', () => {
  assert.equal(compareWithStandard({ points: [] }, 'x'), null)
  assert.equal(compareWithStandard(null, 'x'), null)
})

// ── 提示词 ──
t('标准提示词含分值、材料依据与"参照非答案"约束', () => {
  const out = formatStandardForPrompt(normalizeStandard(good()), { maxScore: 10 })
  assert.ok(out.includes('采分点标准'))
  assert.ok(out.includes('满分 10'))
  assert.ok(out.includes('参照'))
  assert.ok(out.includes('材料依据'))
  assert.ok(out.includes('miss'))
})

t('无标准返回空串（不返回 null，调用方可直接拼）', () => {
  assert.equal(formatStandardForPrompt(null), '')
  assert.equal(formatStandardForPrompt({ points: [] }), '')
})

// ── 随仓库发布的样板 ──
t('样板 public.js 全部通过校验', () => {
  const ids = Object.keys(PUBLIC_STANDARDS)
  assert.ok(ids.length > 0, 'public.js 不该是空的（至少要有一道人工样板）')
  for (const id of ids) {
    const s = PUBLIC_STANDARDS[id]
    assert.equal(s.questionId, id, `${id} 的 questionId 字段与键不一致`)
    const r = validateStandard(s)
    assert.equal(r.ok, true, `${id}: ${r.errors.join('; ')}`)
  }
})

t('样板 builtin-q-01 的采分点之和为 20', () => {
  const sum = PUBLIC_STANDARDS['builtin-q-01'].points.reduce((a, p) => a + p.weight, 0)
  assert.equal(sum, 20)
  assert.equal(PUBLIC_STANDARDS['builtin-q-01'].points.length, 6)
})

t('标准键名不带 builtin- 前缀的话，练习页会取不到（回归护栏）', () => {
  // 仿真题在池子里的 id 是 builtin-<原始 id>；键名必须跟着池子走
  assert.ok(!PUBLIC_STANDARDS['q-01'], '不该存在无前缀的键——那是取不到标准的根源')
  assert.ok(PUBLIC_STANDARDS['builtin-q-01'])
})

// ── 同义表述（synonyms）与反向要点（forbidden_point）────────────────
// 这两个字段直接决定"采分准不准"：
//   synonyms 少了 —— 考生换个说法就被判 miss，覆盖率系统性偏低；
//   forbidden_point 少了 —— 方向写反也能拿分，是最伤信任的一类误判。
// 所以每个字段都配一条"没有它会怎样"的反证，证明它不是装饰。
t('同义表述：考生换一种说法，同样算命中', () => {
  const p = {
    id: 'p1',
    label: '加强组织领导',
    weight: 4,
    keywords: ['领导小组'],
    synonyms: ['成立专班', '由主要领导牵头'],
  }
  assert.equal(matchPoint(p, '成立专班推进此项工作').status, POINT_STATUS.HIT)
})

t('没有同义词时，同样的改写仍是 miss（反证：这个字段不是装饰）', () => {
  const p = { id: 'p1', label: '加强组织领导', weight: 4, keywords: ['领导小组'] }
  assert.equal(matchPoint(p, '成立专班推进此项工作').status, POINT_STATUS.MISS)
})

t('反向要点：方向写错时即使命中关键词也不给分', () => {
  const p = {
    id: 'p1',
    label: '政府应加强监管',
    weight: 4,
    keywords: ['监管'],
    forbidden_point: ['由市场自行调节'],
  }
  const m = matchPoint(p, '政府不应介入，应由市场自行调节资源配置')
  assert.equal(m.status, POINT_STATUS.MISS)
  assert.equal(m.forbidden, true)
  assert.deepEqual(m.matchedForbidden, ['由市场自行调节'])
})

t('反向要点的判据**先于**关键词命中（顺序反了就等于没做）', () => {
  const p = { id: 'p1', label: 'x', weight: 2, keywords: ['监管'], forbidden_point: ['监管应放开'] }
  assert.equal(matchPoint(p, '监管应放开').forbidden, true)
})

t('compareWithStandard 单独统计踩到反向要点的数量', () => {
  const std = normalizeStandard({
    questionId: 'q',
    totalScore: 4,
    points: [{ id: 'p1', label: 'a', weight: 4, keywords: ['监管'], forbidden_point: ['放开管制'] }],
  })
  const cmp = compareWithStandard(std, '应当放开管制')
  assert.equal(cmp.forbiddenCount, 1)
  assert.equal(cmp.earned, 0)
})

t('校验期拦下「同一个词既算同义又算反向」的自相矛盾', () => {
  const bad = normalizeStandard({
    questionId: 'q',
    totalScore: 2,
    points: [{ id: 'p1', label: 'a', weight: 2, synonyms: ['加强'], forbidden_point: ['加强'] }],
  })
  assert.equal(validateStandard(bad).ok, false)
})

t('注入给老师的文本里出现同义表述与反向要点提示', () => {
  const std = normalizeStandard({
    questionId: 'q',
    totalScore: 2,
    points: [{ id: 'p1', label: 'a', weight: 2, synonyms: ['成立专班'], forbidden_point: ['交由市场自决'] }],
  })
  const txt = formatStandardForPrompt(std)
  assert.match(txt, /同义表述/)
  assert.match(txt, /反向要点/)
  assert.match(txt, /成立专班/)
  assert.match(txt, /交由市场自决/)
})

t('规范化必须保留两个新字段（不保留＝录了也白录）', () => {
  const std = normalizeStandard({
    questionId: 'q',
    totalScore: 2,
    points: [{ id: 'p1', label: 'a', weight: 2, synonyms: ['x'], forbidden_point: ['y'] }],
  })
  assert.deepEqual(std.points[0].synonyms, ['x'])
  assert.deepEqual(std.points[0].forbidden_point, ['y'])
})

console.log(`\n采分点标准层单测：${pass} passed, ${fails.length} failed`)
for (const f of fails) console.log(`  ✗ ${f.name}\n    ${f.msg}`)
process.exit(fails.length ? 1 : 0)
