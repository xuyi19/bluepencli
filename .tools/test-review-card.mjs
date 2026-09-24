// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 错误类型归一化 + 复盘卡的测试。
//
// 这里要守住的是**口径**，不是"代码能跑"：
//   · 同一个毛病不管模型怎么写，都必须落进同一个格子 —— 否则 V3 的聚合全是错的
//   · 反例必须挡住（「分类混乱」是分类问题，「层次不清」是结构问题，别混）
//   · 复盘卡的排序规则：**共识优先于扣分**，且单人模式下不许谎称"多位老师都提到"
//
// 用法：node .tools/test-review-card.mjs

import {
  ERROR_TYPES,
  ERROR_TYPE_IDS,
  errorTypeById,
  matchErrorTypes,
  normalizeErrorType,
} from '../frontend/src/data/error-taxonomy.js'
import { buildReviewCard, buildWeaknessProfile } from '../frontend/src/utils/grading/reviewCard.js'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `   —— ${detail}` : ''}`)
}

// ── 一、类型表本身 ────────────────────────────────────────
const ids = ERROR_TYPES.map((t) => t.id)
check('类型表 id 不重复', new Set(ids).size === ids.length)
check('除「其他」外每个类型都写了动笔前自检（复盘卡清单靠它）',
  ERROR_TYPES.filter((t) => t.id !== 'other').every((t) => t.selfCheck && t.selfCheck.length >= 8))
check('errorTypeById 对未知 id 回落到「其他」而不是抛错',
  errorTypeById('不存在的类型').id === 'other')

// ── 二、归一化：同一个毛病的不同写法要落进同一格 ──────────
const CASES = [
  // [模型可能写出来的自由文本, 期望的 id]
  ['采分词缺失', 'point-missing'],
  ['漏点', 'point-missing'],
  ['要点不全', 'point-missing'],
  ['要点遗漏', 'point-missing'],
  ['银发经济的产业属性未点明', 'point-missing'],
  ['分论点三展开不足', 'point-missing'],
  ['结尾没能接住分论点', 'point-missing'],
  ['拆点', 'point-split'],
  ['打乱材料逻辑层次', 'point-split'],
  ['分类混乱', 'point-merge'],
  ['归类不当', 'point-merge'],
  ['整句照抄', 'copy-raw'],
  ['抄了完整句子', 'copy-raw'],
  ['原文照搬、虚词未删', 'copy-raw'],
  ['概括失真', 'over-generalize'],
  ['用生活经验替代原词', 'over-generalize'],
  ['高度概括变成空话', 'over-generalize'],
  ['空话套话', 'empty-talk'],
  ['背景铺垫占字数', 'empty-talk'],
  ['形式不应题', 'off-question'],
  ['没回应问法', 'off-question'],
  ['文体不符', 'off-question'],
  ['结构不清', 'structure'],
  ['段落层次混乱', 'structure'],
  ['缺总起句', 'structure'],
  ['字数超出限定', 'word-count'],
  ['字数不足', 'word-count'],
  ['公文格式不规范', 'format'],
  ['标题与落款缺失', 'format'],
  ['口语化', 'expression'],
  ['表述不规范', 'expression'],
  ['用词搭配不当', 'expression'],
  // 合法 id 直接透传
  ['point-split', 'point-split'],
  ['other', 'other'],
  // 认不出来的宁可归"其他"，不许硬塞
  ['嗯这个有点奇怪', 'other'],
  ['', 'other'],
  [null, 'other'],
]
const bad = []
for (const [raw, want] of CASES) {
  const got = normalizeErrorType(raw)
  if (got !== want) bad.push(`${JSON.stringify(raw)} → ${got}（期望 ${want}）`)
}
check(`自由文本归一化 ${CASES.length} 例全部正确`, bad.length === 0,
  bad.length ? bad.join('；') : '')

// 反例专测：这几对最容易被"关键词都命中"搞混
check('反例：「分类混乱」进分类，不进结构', normalizeErrorType('分类混乱') === 'point-merge')
check('反例：「层次不清」进结构，不进分类', normalizeErrorType('层次不清') === 'structure')
check('反例：「概括不清」进概括，不进结构', normalizeErrorType('概括不清') === 'over-generalize')
// 混合短语才能真正守住规则顺序：单说「形式不应题」哪个规则都不会抢，
// 只有和"结构"类关键词同时出现时，才看得出应题类必须排在前面。
check('反例：应题与结构同时命中时，应题优先（顺序靠前）',
  normalizeErrorType('形式不应题，结构也松散') === 'off-question',
  normalizeErrorType('形式不应题，结构也松散'))
check('反例：漏点与字数同时命中时，漏点优先（"展开不足"不含"不足"陷阱）',
  normalizeErrorType('分论点展开不足') === 'point-missing' && normalizeErrorType('字数不足') === 'word-count')

// 一条批注可能同时属于几类：两处都算
const multi = matchErrorTypes('抄了完整句子，关键词也丢了')
check('一条批注命中多类时两类都算（抄句 + 概括失真）',
  multi.includes('copy-raw') && multi.includes('over-generalize'), JSON.stringify(multi))
check('matchErrorTypes 对合法 id 只回它自己', JSON.stringify(matchErrorTypes('point-split')) === '["point-split"]')

// prompt 要求模型在"一句话犯两种毛病"时写成 `id1,id2` 的复合形式，
// 这种写法必须被认出来 —— 否则新 prompt 一上线，所有复合批注全被归进「其他」。
const compound = matchErrorTypes('copy-raw,over-generalize')
check('复合 id 写法（逗号连接）能被认出来',
  JSON.stringify(compound) === '["copy-raw","over-generalize"]', JSON.stringify(compound))
check('复合 id 归一化取第一个当主类', normalizeErrorType('copy-raw,over-generalize') === 'copy-raw')
check('中文顿号连接也算复合', JSON.stringify(matchErrorTypes('point-split、point-merge')) === '["point-split","point-merge"]')
// 但不能误伤"拆点/合并不当"这种带斜杠的普通短语：一半合法一半不合法 → 退回关键词匹配
check('半合法的斜杠短语不会被当成复合 id（「拆点/合并不当」仍归拆点）',
  normalizeErrorType('拆点/合并不当') === 'point-split',
  normalizeErrorType('拆点/合并不当'))

// ── 三、复盘卡：共识优先 ──────────────────────────────────
const ann = (type, quote, fix) => ({ quote: quote || '考生原文片段', type, comment: '说明', fix: fix || '改法' })
const ded = (point, score, fix) => ({ point, score, reason: '为什么扣', fix: fix || '怎么改' })

/** 造一份记录：三个老师，共识度与扣分故意错开 */
const record = {
  id: 'r1',
  results: [
    // 三人都提到"要点遗漏" → 共识 3，但每人只扣 1 分（共 3）
    { teacherId: 'yuandong', annotations: [ann('要点遗漏', '第一处原文')], deductions: [ded('要点遗漏', 1)] },
    { teacherId: 'zhoutairan', annotations: [ann('漏点', '第二处原文')], deductions: [ded('采分词缺失', 1)] },
    { teacherId: 'bailu', annotations: [ann('要点不全', '第三处原文')], deductions: [ded('要点缺失', 1)] },
  ],
}
// 再单独造一份：只有一位老师，但提到一个扣 20 分的问题
const recordSolo = {
  id: 'r2',
  results: [
    {
      teacherId: 'kiwi',
      annotations: [ann('口语化')],
      deductions: [ded('形式不应题', 20)],
    },
  ],
}

const card = buildReviewCard(record)
check('复盘卡产出成功', card.ok === true, card.reason)
check('共识度高的排第一（3 位老师 vs 单人高分问题）',
  card.topFixes[0]?.categoryId === 'point-missing', card.topFixes[0]?.categoryId)
check('第一位标记为共识（≥2 位老师独立提到）', card.topFixes[0]?.consensus === true)
check('共识数统计正确（3）', card.topFixes[0]?.teacherCount === 3, String(card.topFixes[0]?.teacherCount))
check('共识度相同的项按扣分排序（都是 1 分 → 并列，不报错）', card.topFixes.length >= 1)
check('多人模式下 consensusMeaningful 为真', card.stats.consensusMeaningful === true)

// 单人模式：不许谎称"多位老师都提到"
const solo = buildReviewCard(recordSolo)
check('单人模式照常出复盘卡', solo.ok === true)
check('单人模式下 consensus 一律为 false（不能谎称"多位老师都提到"）',
  solo.topFixes.every((f) => f.consensus === false))
check('单人模式下 consensusMeaningful 为假，UI 可据此换口径',
  solo.stats.consensusMeaningful === false)

// ── 四、复盘卡的边界 ──────────────────────────────────────
const early = buildReviewCard({ results: [] })
check('没有批改结果时 ok=false 且给出原因', early.ok === false && !!early.reason, early.reason)

const allErr = buildReviewCard({ results: [{ teacherId: 'x', error: '调用失败' }] })
check('老师全部报错时不硬出复盘卡', allErr.ok === false && allErr.stats.teacherCount === 0, allErr.reason)

const noIssue = buildReviewCard({ results: [{ teacherId: 'x', annotations: [], deductions: [] }] })
check('没有任何问题时如实说"没批出可归类的具体问题"', noIssue.ok === false && !!noIssue.reason, noIssue.reason)

// 「其他」不上榜：认不出类型就给不出能照做的改法，摆第一位只会让人无从下手
const otherOnly = buildReviewCard({
  results: [{ teacherId: 'x', annotations: [ann('嗯这个有点奇怪')], deductions: [] }],
})
check('「其他问题」不进"最该改的"（给了也照做不了）', otherOnly.ok === false)
const mixed = buildReviewCard({
  results: [
    { teacherId: 'a', annotations: [ann('嗯这个有点奇怪')], deductions: [] },
    { teacherId: 'b', annotations: [ann('口语化')], deductions: [] },
  ],
})
check('但「其他」仍留在 stats 里供错题本统计',
  mixed.stats.categories.some((c) => c.id === 'other') && mixed.topFixes.every((f) => f.categoryId !== 'other'))

// 只有批注、没有扣分项，也要能用
const annOnly = buildReviewCard({
  results: [{ teacherId: 'a', annotations: [ann('抄了完整句子')], deductions: [] }],
})
check('只有逐句批注、没有扣分项时照常出卡', annOnly.ok === true, annOnly.reason)

// 条数上限与去重
const manyFix = buildReviewCard({
  results: [{
    teacherId: 'a',
    annotations: [
      ann('漏点', 'q1', '同一个改法'),
      ann('漏点', 'q2', '同一个改法'),
      ann('漏点', 'q3', '另一个改法'),
      ann('漏点', 'q4', '第三个改法'),
      ann('漏点', 'q5', '第四个改法'),
    ],
    deductions: [],
  }],
})
check('原文与改法都去重且最多留 3 条',
  manyFix.topFixes[0].quotes.length <= 3 && manyFix.topFixes[0].fixes.length <= 3,
  `quotes=${manyFix.topFixes[0].quotes.length} fixes=${manyFix.topFixes[0].fixes.length}`)
check('重复的改法只留一条', manyFix.topFixes[0].fixes.filter((f) => f.text === '同一个改法').length === 1)

// topN 可控
const top1 = buildReviewCard(record, { topN: 1 })
check('topN 可控（这里是 1）', top1.topFixes.length === 1)
check('清单条数与上榜项一致', top1.checklist.length === 1)

// ── 五、跨记录的短板统计 ──────────────────────────────────
const mk = (id, types) => ({
  id,
  results: [{ teacherId: 'a', annotations: types.map((t) => ann(t)), deductions: [] }],
})
const profile = buildWeaknessProfile([
  mk('p1', ['要点遗漏']),
  mk('p2', ['要点遗漏']),
  mk('p3', ['口语化']),
])
check('短板统计按"栽在几份记录里"排（要点遗漏 2 份 > 口语化 1 份）',
  profile.items[0]?.id === 'point-missing' && profile.items[0].recordCount === 2,
  JSON.stringify(profile.items.map((i) => `${i.id}:${i.recordCount}`)))
check('「其他」不进短板画像', profile.items.every((i) => i.id !== 'other'))

const oneRecord = buildWeaknessProfile([mk('p1', ['要点遗漏'])])
check('只有一份记录时 enough=false（不能就说"你的短板是…"）', oneRecord.enough === false)
check('记录够时才敢下结论', profile.enough === true)

// ── 六、做得好：只采信老师明确写出的肯定 ────────────────────
// 这一节的要害是**不许无中生有**：
//   · 老师没写 highlights 就是没有 —— 不许从"没被批评"反推"做得好"（没测到 ≠ 测到了）；
//   · 也不许拿"得分率高的分项"充数：那是模型自评，不构成"具体做对了什么"。
const recWithGood = {
  id: 'r-good',
  results: [
    {
      teacherId: 'yuandong',
      annotations: [],
      deductions: [],
      highlights: [{ point: '开篇点题干脆', why: '阅卷人一眼就知道你要答什么' }],
    },
    {
      teacherId: 'zhoutairan',
      annotations: [],
      deductions: [],
      highlights: [{ point: '开篇点题干脆', why: '开门见山' }],
    },
  ],
}
const cardGood = buildReviewCard(recWithGood)
check('老师写的亮点进了复盘卡', cardGood.strengths.length >= 1, cardGood.strengths.map((s) => s.text).join('；'))
check('亮点带回「为什么好」', cardGood.strengths.every((s) => s.why), cardGood.strengths[0]?.why)
check('多位老师写同一条 → 合并为一条并标共识',
  cardGood.strengths.length === 1 && cardGood.strengths[0].consensus === true,
  `条数=${cardGood.strengths.length} consensus=${cardGood.strengths[0]?.consensus}`)
check('stats 记下亮点总数', cardGood.stats.highlightTotal === 2, String(cardGood.stats.highlightTotal))

const cardNone = buildReviewCard({
  id: 'r-none',
  results: [
    {
      teacherId: 'yuandong',
      annotations: [{ quote: '这一句写得比较空', type: 'empty-talk', comment: 'x', fix: 'y' }],
      deductions: [{ point: '空话套话', score: 2 }],
    },
  ],
})
check('老师没写亮点 → strengths 是空数组（绝不从"没被批评"反推做得好）',
  Array.isArray(cardNone.strengths) && cardNone.strengths.length === 0)
check('没有亮点但有问题 → 复盘卡主体照常可用', cardNone.ok === true && cardNone.topFixes.length >= 1)

const cardSolo = buildReviewCard({
  id: 'r-solo',
  results: [{ teacherId: 'yuandong', annotations: [], deductions: [], highlights: [{ point: '结构清晰', why: 'x' }] }],
})
check('单人模式下亮点不打「多位老师都提到」（不许谎称共识）',
  cardSolo.strengths.length === 1 && cardSolo.strengths[0].consensus === false)

check('脏数据（highlights 缺 point 或全空白）被跳过，不产生空白行',
  buildReviewCard({
    id: 'r-dirty',
    results: [
      { teacherId: 'a', annotations: [], deductions: [], highlights: [{ why: '没有 point' }, { point: '   ' }] },
    ],
  }).strengths.length === 0)

check('没有批改结果时不崩，且 strengths 为空',
  buildReviewCard({ id: 'r-empty', results: [] }).strengths.length === 0)

// 合议综合的 highlights 是主来源：多数老师根本不输出这个字段（契约里是条件性的），
// 只从老师那头取会得到"永远没有亮点"——这是第一版踩到的坑。
check('合议综合的亮点能取到（老师个人没写时唯一的来源）',
  buildReviewCard({
    id: 'r-final',
    results: [{ teacherId: 'a', annotations: [], deductions: [] }],
    highlights: [{ point: '开头引用贴切', why: '入题自然' }],
  }).strengths.length === 1)
check('合议与老师都写了同一条时不重复列（合议本就综合自老师）',
  buildReviewCard({
    id: 'r-dedup',
    results: [
      { teacherId: 'a', annotations: [], deductions: [], highlights: [{ point: '开头引用贴切', why: 'x' }] },
    ],
    highlights: [{ point: '开头引用贴切', why: 'y' }],
  }).strengths.length === 1)

// 结果页传的是 orchestrator 的 report（highlights 在 final 里），记录页传的是 buildRecord
// 的结果（highlights 在顶层）。只认一种，"做得好"在那一侧就永远是空的 —— 且不报错。
check('结果页形态（highlights 在 final 里）也能取到',
  buildReviewCard({
    id: 'r-report',
    results: [{ teacherId: 'a', annotations: [], deductions: [] }],
    final: { highlights: [{ point: '分论点排布清楚', why: '一眼能跟上' }] },
  }).strengths.length === 1)

// ── 收尾 ─────────────────────────────────────────────────
console.log('')
const failed = results.filter((r) => !r.ok)
console.log(`错误类型与复盘卡测试：${results.length - failed.length} passed, ${failed.length} failed`)
if (failed.length) console.log('未通过：' + failed.map((f) => f.name).join(' / '))
process.exit(failed.length ? 1 : 0)
