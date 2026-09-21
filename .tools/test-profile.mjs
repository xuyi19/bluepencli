// 能力画像（utils/grading/profile.js）的护栏。
//
// 这里盯的都是「看起来正常、其实是假信号」的那类错：
//   ① 样本不足却照样出分（读者会以为"我的能力就是这样"）；
//   ② 没数据的维度被画成 0 分或 100 分（"没评"被读成"很差/很强"）；
//   ③ 一篇批注都没有的记录，把所有维度推高（未判 = 做得好，最典型）；
//   ④ 自由文本类型没归一化（"层次不清"应该进 structure）。
//
// 跑法：node .tools/test-profile.mjs

const { registerViteAlias } = await import('file:///E:/code/bluepencil/.tools/vite-alias.mjs')
registerViteAlias()

const { buildProfile, weakestDimension, MIN_RECORDS, PROFILE_DIMENSIONS } =
  await import('file:///E:/code/bluepencil/frontend/src/utils/grading/profile.js')

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${extra ? '  → ' + extra : ''}`)
  }
}
const dim = (p, id) => (p.dimensions || []).find((d) => d.id === id)

/** 造一条记录；annotations 是 [type] 或 [type, ...] */
function rec(n, annotations = [], keyPoints = null) {
  return {
    id: 'r' + n,
    finalScore: 20,
    maxScore: 40,
    wordCount: 300,
    keyPoints,
    results: [{ teacherId: 'yuandong', annotations: annotations.map((t) => ({ type: t, comment: '' })) }],
  }
}

const KP_ALL_HIT = [
  { point: 'a', status: 'hit', weight: 10, earned: 10 },
  { point: 'b', status: 'hit', weight: 10, earned: 10 },
]
const KP_HALF = [
  { point: 'a', status: 'hit', weight: 10, earned: 10 },
  { point: 'b', status: 'miss', weight: 10, earned: 0 },
]

console.log('\n── 样本门槛 ──')
{
  const p1 = buildProfile([rec(1, ['结构失当'])])
  ok(`${MIN_RECORDS} 篇以下不算数（1 篇 → ready=false）`, p1.ready === false)
  ok('并且 need 报出还差几篇', p1.need === MIN_RECORDS - 1, `need=${p1.need}`)

  const p3 = buildProfile([rec(1, ['结构失当']), rec(2, ['照抄']), rec(3, ['口语'])])
  ok('满 3 篇 → ready=true', p3.ready === true)
}

console.log('\n── 没有批注的篇不能参与"未出现即好" ──')
{
  // 三篇里两篇**根本没有批注**，只有一篇被判了"结构失当"。
  // 若把空批注的篇也算进分母，structure 会变成 67 分（看着"结构还行"）—— 假的。
  const withEmpty = [
    rec(1, ['结构失当']),
    { ...rec(2, []), results: [] },
    { ...rec(3, []), results: [] },
  ]
  const p = buildProfile(withEmpty)
  ok('judgedCount 只数有批注的篇', p.judgedCount === 1, `judgedCount=${p.judgedCount}`)
  ok('structure = 0（那一篇确实判了结构问题）', dim(p, 'structure').score === 0, `score=${dim(p, 'structure').score}`)
}

console.log('\n── 没数据的维度必须是「不适用」，不能是 0 也不能是 100 ──')
{
  const p = buildProfile([rec(1, ['口语']), rec(2, ['口语']), rec(3, ['口语'])])
  const cov = dim(p, 'coverage')
  ok('没有采分点数据 → coverage 不适用', cov.applicable === false && cov.score === null)
  const st = dim(p, 'structure')
  ok('没判过结构 → structure 满分 100（确实一次没被判）', st.score === 100, `score=${st.score}`)
  ok('但 samples 要如实报参与篇数', st.samples === 3, `samples=${st.samples}`)
}

console.log('\n── 要点覆盖采分点命中率 ──')
{
  const p = buildProfile([rec(1, [], KP_ALL_HIT), rec(2, [], KP_ALL_HIT), rec(3, [], KP_ALL_HIT)])
  ok('全命中 → 100', dim(p, 'coverage').score === 100)

  const p2 = buildProfile([rec(1, [], KP_HALF), rec(2, [], KP_HALF), rec(3, [], KP_HALF)])
  ok('一半命中 → 50', dim(p2, 'coverage').score === 50, `score=${dim(p2, 'coverage').score}`)

  // earned 缺了也要能算（老记录只有 status）
  const p3 = buildProfile([
    rec(1, [], [{ point: 'a', status: 'hit', weight: 10 }]),
    rec(2, [], [{ point: 'a', status: 'partial', weight: 10 }]),
    rec(3, [], [{ point: 'a', status: 'miss', weight: 10 }]),
  ])
  ok('earned 缺失时按 status 折算（100/50/0 → 50）', dim(p3, 'coverage').score === 50, `score=${dim(p3, 'coverage').score}`)
}

console.log('\n── 自由文本归一化（口径定死的意义所在）──')
{
  // 「层次不清」与「结构混乱」必须是同一个维度，否则画像会随措辞漂移
  const p = buildProfile([
    rec(1, ['层次不清']),
    rec(2, ['结构混乱']),
    rec(3, ['段落失衡']),
  ])
  ok('三种写法都归到 structure → 0 分', dim(p, 'structure').score === 0, `score=${dim(p, 'structure').score}`)
  ok('并且记下了命中的类型名', dim(p, 'structure').topErrors.length > 0)
}

console.log('\n── 最弱项：没依据就闭嘴 ──')
{
  const few = buildProfile([rec(1, ['口语'])])
  ok('ready=false 时不给最弱项', weakestDimension(few) === null)

  // 只有一维可用 → 说"你这方面最弱"是废话（没有比较对象）
  const oneDim = buildProfile([
    rec(1, [], KP_ALL_HIT),
    rec(2, [], KP_ALL_HIT),
    rec(3, [], KP_ALL_HIT),
  ])
  const usable = oneDim.dimensions.filter((d) => d.applicable)
  ok('只有一维可用时不给最弱项', usable.length < 2 ? weakestDimension(oneDim) === null : true,
    `usable=${usable.length}`)

  const p = buildProfile([
    rec(1, ['结构失当'], KP_ALL_HIT),
    rec(2, ['结构失当'], KP_ALL_HIT),
    rec(3, ['结构失当'], KP_ALL_HIT),
  ])
  const w = weakestDimension(p)
  ok('结构全篇都判了 → 最弱项是 structure', w?.id === 'structure', `weakest=${w?.id}`)
}

console.log('\n── 维度表本身 ──')
{
  ok('维度数量固定为 6', PROFILE_DIMENSIONS.length === 6)
  ok('每个维度都有 basis 口径', PROFILE_DIMENSIONS.every((d) => d.basis && d.basis.length > 4))
  ok('空输入不炸', buildProfile([]).ready === false)
  ok('null 输入不炸', buildProfile(null).ready === false)
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} 通过 / ${fail} 失败\n`)
process.exit(fail ? 1 : 0)
