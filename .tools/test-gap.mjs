// ──────────────────────────────────────────────────────────────
// 对标差距报告（gap.js）护栏
// 断言口径：只断言用户看得见的结果（每点状态/引用户原句/冗余句文本/verdict 文案），
// 不锁内部变量写法 —— 护栏要能区分「功能对」和「功能被删掉」。
// 跑法：node .tools/test-gap.mjs（已被 test-all.mjs 自动收集）
// ──────────────────────────────────────────────────────────────
import assert from 'node:assert/strict'
import { buildGapReport, splitSentences, sentenceHit } from '../frontend/src/utils/grading/gap.js'

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

const std = () => ({
  totalScore: 10,
  points: [
    { id: 'p1', label: '加强基础设施建设', weight: 4, evidence: ['拓宽村道硬化路面'], keywords: ['基础设施'] },
    { id: 'p2', label: '发展特色产业', weight: 3, evidence: [], keywords: ['甲销', '乙产'], synonyms: ['特色种植'] },
    { id: 'p3', label: '整治人居环境', weight: 3, evidence: [], keywords: ['垃圾清运', '保洁员'], synonyms: [] },
  ],
})
const ans = () =>
  '第一，要拓宽村道硬化路面，补齐基础设施短板。' +
  '第二，依托本地资源搞特色种植。' +
  '村里基础设施太差，群众反映强烈。'

// ── splitSentences ──
t('分句：按句终标点切且保留标点', () => {
  const ss = splitSentences('甲来了要走。乙走了要来！丙又要去哪呢？丁说：这样很好。')
  assert.deepEqual(ss.map((s) => s.text), ['甲来了要走。', '乙走了要来！', '丙又要去哪呢？', '丁说：这样很好。'])
})
t('分句：换行也切', () => {
  const ss = splitSentences('第一行内容\n第二行内容')
  assert.equal(ss.length, 2)
})
t('分句：归一化后不足 4 字的残句丢弃', () => {
  const ss = splitSentences('这是一句完整的话。嗯。啊？！然后这是另一句完整的话。')
  assert.equal(ss.length, 2, JSON.stringify(ss))
})

// ── sentenceHit ──
t('句级命中：evidence 片段（≥8 字）', () => {
  const h = sentenceHit('要拓宽村道硬化路面', { evidence: ['拓宽村道硬化路面'], keywords: [] })
  assert.equal(h?.via, 'evidence')
})
t('句级命中：关键词', () => {
  const h = sentenceHit('补齐基础设施短板', { evidence: [], keywords: ['基础设施'] })
  assert.equal(h?.via, 'keyword')
})
t('句级命中：同义词', () => {
  const h = sentenceHit('搞特色种植', { evidence: [], keywords: [], synonyms: ['特色种植'] })
  assert.equal(h?.via, 'synonym')
})
t('句级不命中：返回 null', () => {
  assert.equal(sentenceHit('天气很好', { evidence: ['拓宽村道硬化路面'], keywords: ['基础设施'] }), null)
})
t('句级：短片段（<8 字）不当 evidence 判', () => {
  assert.equal(sentenceHit('路面', { evidence: ['路面'], keywords: [] }), null)
})

// ── buildGapReport 守卫 ──
t('大作文/无采分点 → null（不渲染对标）', () => {
  assert.equal(buildGapReport({ points: [] }, ans()), null)
  assert.equal(buildGapReport(null, ans()), null)
})
t('作答过短（<10 字）→ null', () => {
  assert.equal(buildGapReport(std(), '基础设施'), null)
})

// ── 逐点对齐 ──
t('写到（hit）：引我写的原句', () => {
  const r = buildGapReport(std(), ans())
  const row = r.rows.find((x) => x.id === 'p1')
  assert.equal(row.status, 'hit')
  assert.ok(row.myQuote.includes('拓宽村道硬化路面'), row.myQuote)
  assert.ok(row.myQuote.includes('基础设施'), '引句应是完整句而非片段')
})
t('同义词命中也算写到，via 标 synonym', () => {
  const r = buildGapReport(std(), ans())
  const row = r.rows.find((x) => x.id === 'p2')
  assert.equal(row.status, 'hit')
  assert.equal(row.via, 'synonym')
  assert.ok(row.myQuote.includes('特色种植'))
})
t('全没沾上 → miss，myQuote 为 null，standardHint 给标准表述', () => {
  const r = buildGapReport(std(), ans())
  const row = r.rows.find((x) => x.id === 'p3')
  assert.equal(row.status, 'miss')
  assert.equal(row.myQuote, null)
  assert.equal(row.standardHint, '整治人居环境')
})

// ── 反向要点（最伤信任的误判方向）──
t('答反方向：forbidden 最先判、状态 miss、0 分权重', () => {
  const s = std()
  s.points.push({ id: 'p4', label: '加大财政投入', weight: 5, evidence: [], keywords: ['财政投入'], forbidden_point: ['大拆大建'] })
  const a = ans() + '村民希望大拆大建快点搞起来。'
  const r = buildGapReport(s, a)
  const row = r.rows.find((x) => x.id === 'p4')
  assert.equal(row.status, 'miss')
  assert.equal(row.forbidden, true)
  // coverage 里 forbidden 点权重按 0 计
  assert.ok(!r.verdicts.some((v) => v.includes('财政投入')), 'verdict 不该把 forbidden 当普通漏点')
})

// ── 冗余分析 ──
t('与任何点都不沾边的句子进冗余清单，rate 按字数占比', () => {
  const base = ans()
  const junk = '天气很好，大家都很开心，这句和要点完全无关纯属废话凑字数。'
  const r = buildGapReport(std(), base + junk)
  assert.ok(r.redundancy.sentences.some((s) => s.includes('天气很好')), JSON.stringify(r.redundancy))
  assert.ok(r.redundancy.rate > 0)
  // 有效句全部沾点时冗余为 0
  const r2 = buildGapReport(std(), base)
  assert.equal(r2.redundancy.sentences.length, 0, JSON.stringify(r2.redundancy))
  assert.equal(r2.redundancy.rate, 0)
})
t('冗余句里沾上任意一点就不算冗余（判据从严防误杀）', () => {
  const r = buildGapReport(std(), ans() + '垃圾清运要常态化，保洁员要配齐。')
  assert.equal(r.redundancy.sentences.length, 0)
})

// ── 覆盖率（分值加权，partial 折半）──
t('coverage：分值加权 + partial 折半', () => {
  const s = std()
  // p1(4) hit=4, p2(3) 改成 partial=1.5, p3(3) miss=0 → 55%
  const a = '要拓宽村道硬化路面补齐基础设施短板。发展甲销。第三点完全没写。'
  const r = buildGapReport(s, a)
  const row2 = r.rows.find((x) => x.id === 'p2')
  assert.equal(row2.status, 'partial')
  assert.equal(r.stats.coverage, 55)
})
t('stats 各计数与 rows 一致', () => {
  const r = buildGapReport(std(), ans())
  assert.equal(r.stats.totalPoints, 3)
  assert.equal(r.stats.hitCount, 2)
  assert.equal(r.stats.missCount, 1)
  assert.equal(r.stats.partialCount, 0)
  assert.equal(r.stats.forbiddenCount, 0)
})

// ── verdict（用户看得见的文案）──
t('verdict：forbidden 优先说话', () => {
  const s = std()
  s.points.push({ id: 'p4', label: 'x', weight: 5, evidence: [], keywords: ['k'], forbidden_point: ['大拆大建'] })
  const r = buildGapReport(s, ans() + '村民希望大拆大建。')
  assert.ok(r.verdicts[0].includes('答反了方向'), r.verdicts.join('|'))
})
t('verdict：漏点说话（含漏点个数）', () => {
  const r = buildGapReport(std(), '要拓宽村道硬化路面补齐基础设施短板。发展甲销。')
  assert.ok(r.verdicts.some((v) => v.includes('漏了 1 个要点')), r.verdicts.join('|'))
})
t('verdict：冗余 ≥45% 说话', () => {
  const a =
    '要拓宽村道硬化路面补齐基础设施短板。发展特色种植形成产业规模形成产业集群带动就业增收致富奔小康走向美好生活。' +
    '另外说一下村里的花很美，山也很高，水也很清，空气很新鲜，大家心情都很好，日子过得很舒坦，村庄非常宜居宜业和美。'
  const r = buildGapReport(std(), a)
  assert.ok(r.stats.redundantRate >= 45, `rate=${r.stats.redundantRate}`)
  assert.ok(r.verdicts.some((v) => v.includes('篇幅与采分点无关')), r.verdicts.join('|'))
})
t('verdict：全中 → 练表述', () => {
  const s = { totalScore: 7, points: std().points.slice(0, 2) }
  const r = buildGapReport(s, ans())
  assert.ok(r.verdicts.some((v) => v.includes('要点全中')), r.verdicts.join('|'))
})
t('verdict：默认 → 覆盖率数字（有 partial 无 miss 不走漏点/全中分支）', () => {
  const s = {
    totalScore: 10,
    points: [
      { id: 'a', label: '要点A', weight: 4, evidence: ['拓宽村道硬化路面'], keywords: [] },
      { id: 'b', label: '要点B', weight: 3, evidence: [], keywords: ['甲销', '乙产'] },
      { id: 'c', label: '要点C', weight: 3, evidence: [], keywords: ['垃圾清运'] },
    ],
  }
  const r = buildGapReport(s, '要拓宽村道硬化路面。搞甲销售。垃圾清运要常态化。')
  assert.equal(r.stats.missCount, 0)
  assert.equal(r.stats.hitCount, 2, 'p2 应是 partial')
  assert.ok(r.verdicts.some((v) => v.includes('要点覆盖')), r.verdicts.join('|'))
})

// ── 「护栏钉错误实现」自查：改动判据必须让断言变红 ──
t('证据片段在作答里被改写一个字 → 不算写到（判据从严）', () => {
  const s = std()
  const a = '要拓宽村道硬化的路面。' // 「硬化」后多了「的」——逐字判不过
  const r = buildGapReport(s, a)
  const row = r.rows.find((x) => x.id === 'p1')
  // 但 keyword「基础设施」也不在 → miss
  assert.equal(row.status, 'miss')
})

console.log(`\n对标差距报告护栏: ${pass} passed, ${fails.length} failed`)
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f.name}\n    ${f.msg}`)
  process.exit(1)
}
