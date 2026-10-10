// ──────────────────────────────────────────────────────────────
// 标准更新包（standardsPack.js）护栏
// 断言用户可见结果：validate 的拒收文案、applyPack 的替换计数、
// 损坏包降级为空表（宁可回到内置标准，不能污染评分链路）。
// 跑法：node .tools/test-standards-pack.mjs（被 test-all.mjs 自动收集）
// ──────────────────────────────────────────────────────────────
import assert from 'node:assert/strict'
import { registerViteAlias } from './vite-alias.mjs'
registerViteAlias() // index.js 里有省略后缀/别名 import —— 必须先注册再动态 import
import { validatePack, applyPack, getPackInfo, removePack, loadImportedStandards, PACK_MAGIC } from '../frontend/src/utils/standardsPack.js'

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

/** 假 localStorage（Map 语义） */
function fakeStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  }
}

const goodPack = () => ({
  magic: PACK_MAGIC,
  version: 1,
  exportedAt: '2026-10-10T00:00:00Z',
  count: 2,
  standards: {
    'real-2020-gwy-1': {
      questionId: 'real-2020-gwy-1', source: 'manual', totalScore: 10,
      points: [{ id: 'p1', label: '要点一', weight: 6, evidence: [], keywords: ['甲'] }, { id: 'p2', label: '要点二', weight: 4, evidence: [], keywords: ['乙'] }],
    },
    'builtin-q-01': {
      questionId: 'builtin-q-01', source: 'manual', totalScore: 15,
      points: [{ id: 'p1', label: '唯一要点', weight: 15, evidence: ['这是一段足够长的材料证据原文'], keywords: [] }],
    },
  },
})

// ── validatePack：拒收要报得清楚 ──
t('合格包通过', () => {
  const v = validatePack(goodPack())
  assert.equal(v.ok, true, v.problems.join(';'))
  assert.equal(v.count, 2)
})
t('非对象 / 缺 magic / 缺 standards 都拒收', () => {
  assert.equal(validatePack(null).ok, false)
  assert.equal(validatePack([1]).ok, false)
  assert.equal(validatePack({ version: 1, standards: {} }).ok, false, '缺 magic')
  assert.ok(validatePack({ magic: PACK_MAGIC, version: 1 }).problems.some((p) => p.includes('standards')))
})
t('版本不支持拒收', () => {
  const p = goodPack()
  p.version = 2
  assert.ok(validatePack(p).problems.some((x) => x.includes('版本')))
})
t('空包（没有标准）拒收', () => {
  const p = goodPack()
  p.standards = {}
  const v = validatePack(p)
  assert.equal(v.ok, false)
})
t('权重合计 ≠ 满分 拒收', () => {
  const p = goodPack()
  p.standards['real-2020-gwy-1'].points[0].weight = 5 // 5+4=9 ≠ 10
  assert.ok(validatePack(p).problems.some((x) => x.includes('权重合计')))
})
t('同义表述与反向要点重复 拒收（判据自相矛盾）', () => {
  const p = goodPack()
  p.standards['real-2020-gwy-1'].points[0].synonyms = ['加强']
  p.standards['real-2020-gwy-1'].points[0].forbidden_point = ['加强']
  assert.ok(validatePack(p).problems.some((x) => x.includes('反向要点')))
})
t('_ 前缀空占位不计入 count、不参与校验', () => {
  const p = goodPack()
  p.standards['_'] = null
  p.standards['_placeholder'] = { points: null }
  const v = validatePack(p)
  assert.equal(v.ok, true)
  assert.equal(v.count, 2)
})

// ── applyPack：整包替换语义 ──
t('首次导入：replaced = 0', () => {
  const s = fakeStorage()
  const r = applyPack(goodPack(), s)
  assert.equal(r.ok, true)
  assert.equal(r.replaced, 0)
  assert.equal(getPackInfo(s).count, 2)
})
t('再次导入：旧包被整包替换（replaced = 旧包题数）', () => {
  const s = fakeStorage()
  applyPack(goodPack(), s)
  const p2 = goodPack()
  p2.standards['real-2021-gwy-9'] = p2.standards['builtin-q-01']
  delete p2.standards['builtin-q-01']
  const r = applyPack(p2, s)
  assert.equal(r.replaced, 2)
  // 旧包的题不在了 —— 是替换不是叠加
  assert.equal(loadImportedStandards(s)['builtin-q-01'], undefined)
  assert.ok(loadImportedStandards(s)['real-2021-gwy-9'])
})
t('校验不过的包不落盘（旧包原样保留）', () => {
  const s = fakeStorage()
  applyPack(goodPack(), s)
  const bad = goodPack()
  bad.standards['real-2020-gwy-1'].points[0].weight = 99
  const r = applyPack(bad, s)
  assert.equal(r.ok, false)
  assert.equal(getPackInfo(s).count, 2, '旧包必须原样保留')
})
t('removePack 后回到空表', () => {
  const s = fakeStorage()
  applyPack(goodPack(), s)
  removePack(s)
  assert.equal(getPackInfo(s), null)
  assert.deepEqual(loadImportedStandards(s), {})
})

// ── 损坏包：降级空表，不炸 ──
t('损坏的包 loadImportedStandards 返回空表', () => {
  const s = fakeStorage()
  s.setItem('bp-std-pack', '{not json')
  assert.deepEqual(loadImportedStandards(s), {})
})
t('standards 不是对象 → 空表', () => {
  const s = fakeStorage()
  s.setItem('bp-std-pack', JSON.stringify({ magic: PACK_MAGIC, version: 1, standards: [1, 2] }))
  assert.deepEqual(loadImportedStandards(s), {})
})

// ── Node 直跑安全（.tools 工具链会 import data/standards/index.js）──
t('无 localStorage 时 loadImportedStandards 返回空表（不炸加载期）', () => {
  // 本文件就是 Node 直跑 —— 不传 storage 直接调，正是工具链的处境
  assert.deepEqual(loadImportedStandards(), {})
})
t('data/standards/index.js 在 Node 直跑下可加载且不炸', async () => {
  const { getStandard, standardOrigin, standardCount } = await import('../frontend/src/data/standards/index.js')
  assert.equal(typeof standardCount(), 'number')
  assert.equal(standardOrigin('不存在的题'), null)
  assert.equal(getStandard(''), null)
})

console.log(`\n标准更新包护栏: ${pass} passed, ${fails.length} failed`)
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f.name}\n    ${f.msg}`)
  process.exit(1)
}
