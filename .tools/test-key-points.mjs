// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 采分点归并的测试。
//
// 为什么这个测试非写不可：
//   这个模块是**真 bug 逼出来的** —— 第一次真实批改（三师圆桌 glm-4-flash）跑出来
//   6 条 keyPoints，其中 2 条文字完全相同，weight 合计 21 而标准只有 20。
//   根因是 orchestrator 用 flatMap 把三份 keyPoints 直接拼起来。
//   而前端结果页的「命中 X / Y 项」就是数数组长度 —— **数字必定是假的**。
//
//   最要命的不是重复，是**它能骗过所有「能跑」的测试**：
//   数组非空、字段齐全、UI 渲染正常。只有拿真数据算一遍才看得出来。
//   所以这里的断言全部围绕**恒等式**（权重合计 == 标准满分、点数 == 标准点数），
//   不是「函数返回了东西」。
//
// 用法：node .tools/test-key-points.mjs

import { mergeKeyPoints, summarizeKeyPoints, SIMILARITY_THRESHOLD } from '../frontend/src/utils/grading/keyPoints.js'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `   —— ${detail}` : ''}`)
}

// ---------- 测试数据：复刻内置仿真题 builtin-q-01 的标准（6 点 / 合计 20 分）----------
// ⚠️ keywords 必须带上 —— 它是匹配的主要判据。
//    第一次写测试时我省略了 keywords，于是关键词判据整个失效、只剩相似度，
//    结果 6 个标准点只配上 1 个。**测试数据不完整会让正确的实现看起来是错的**。
const STANDARD = {
  questionId: 'builtin-q-01',
  totalScore: 20,
  points: [
    { id: 'p1', label: '强化组织保障：成立省级领导小组、多部门参与、建立调度考核机制并纳入实绩考核', weight: 4, keywords: ['领导小组', '部门参与', '月调度', '实绩考核'] },
    { id: 'p2', label: '加大资金投入：设立省级专项资金，对成效突出的县给予奖补', weight: 3, keywords: ['专项资金', '奖补', '财政'] },
    { id: 'p3', label: '健全标准体系：制定评价指标体系，明确考核维度与指标数量', weight: 3, keywords: ['评价指标', '维度', '28'] },
    { id: 'p4', label: '推进农业数字化：建设智慧农业平台、实时监测并推送生产建议、联合科研机构培训新农人', weight: 4, keywords: ['智慧农业', '高标准农田', '灌溉', '施肥', '培训', '新农人'] },
    { id: 'p5', label: '发展农村电商：建设县域电商公共服务中心，统一品牌包装物流并给予物流补贴', weight: 3, keywords: ['电商', '直播', '品牌', '物流', '补贴'] },
    { id: 'p6', label: '创新乡村治理：开发微治理小程序，实现事项上报、自动派单、办结评价闭环', weight: 3, keywords: ['小程序', '派单', '治理', '上报'] },
  ],
}

/** 构造一位老师的结果 */
const teacher = (id, name, keyPoints) => ({ teacherId: id, teacherName: name, keyPoints })

// ══════════════════════════════════════════════════════════════
console.log('\n── 1. 有标准：按标准点对齐，点数与权重必须与标准完全一致')
// 真实场景复刻：三位老师各写各的措辞，其中两位把 p1 写成了几乎一样的长句
const three = [
  teacher('yuandong', '袁东', [
    { point: '省级统筹，成立领导小组，16部门参与，建立"月调度、季通报、年考核"机制；年设专项资金20亿元', status: 'hit', weight: 4 },
    { point: '建"智慧农业大脑"监测农田、推送农事建议，共建试验站培训新农人', status: 'hit', weight: 4 },
  ]),
  teacher('zhoutairan', '周泰然', [
    { point: '省级统筹，成立领导小组，16部门参与，建立调度考核机制；年设专项资金并奖补', status: 'hit', weight: 4 },
    { point: '县级落地：建设智慧农业平台，培训新农人；发展农村电商，补贴物流', status: 'hit', weight: 4 },
  ]),
  teacher('bailu', '白鹭', [
    { point: '省财政每年安排专项资金20亿元，对成效突出的县给予每县最高2000万元奖补', status: 'partial', weight: 2 },
    { point: '制定《数字乡村建设评价指标体系》，从基础设施、产业数字化、治理数字化、服务数字化4个维度设置28项指标', status: 'miss', weight: 3 },
  ]),
]

const merged = mergeKeyPoints(three, STANDARD)
const sum = summarizeKeyPoints(merged)

check('点数等于标准点数（6 点）', merged.length === 6, `实际 ${merged.length} 条`)
check(
  '权重合计等于标准满分（20）—— 这是最关键的恒等式',
  sum.weightSum === 20,
  `实际 ${sum.weightSum}`
)
check('没有重复点（归并前 6 条里有 2 条是 p1）', new Set(merged.map((m) => m.point)).size === merged.length)

// p2 被两位老师以不同措辞提到（"专项资金+奖补"），必须合成一条
const p2 = merged.find((m) => m.standardId === 'p2')
check('同义措辞被合成一条（p2 只出现一次）', !!p2 && merged.filter((m) => m.standardId === 'p2').length === 1)
check('合并后 status 取最好（hit > partial）', p2?.status === 'hit', `实际 ${p2?.status}`)
check('points 顺序与标准一致', merged.map((m) => m.standardId).slice(0, 6).join(',') === 'p1,p2,p3,p4,p5,p6')

// ══════════════════════════════════════════════════════════════
console.log('\n── 2. 老师都没提到的标准点，必须作为 miss 列出来（这正是考生最需要的）')
const onlyOne = mergeKeyPoints([teacher('yuandong', '袁东', [
  { point: '成立领导小组，多部门参与，建立调度考核机制', status: 'hit', weight: 4 },
])], STANDARD)
const missPoints = onlyOne.filter((m) => m.status === 'miss')
check('未提及的标准点仍出现在结果里', onlyOne.length === 6, `实际 ${onlyOne.length} 条`)
check('未提及的点标为 miss', missPoints.length === 5, `实际 ${missPoints.length} 条 miss`)
check('miss 点 earned 为 0', missPoints.every((m) => m.earned === 0))
check('miss 点 sources 为空（没有老师给过它）', missPoints.every((m) => m.sources.length === 0))

// ══════════════════════════════════════════════════════════════
console.log('\n── 3. 有标准时，点文本与分值一律以标准为准')
check('文本用标准的 label，不用老师的措辞', merged[0].point === STANDARD.points[0].label)
check(
  '每位老师的措辞差异不会被当成不同点',
  merged.filter((m) => m.standardId === 'p1').length === 1
)

// ══════════════════════════════════════════════════════════════
console.log('\n── 4. 老师写出、标准未收录的好点：保留但不并进标准点')
const withExtra = mergeKeyPoints([
  teacher('yuandong', '袁东', [
    { point: '成立领导小组，多部门参与，建立调度考核机制', status: 'hit', weight: 4 },
    { point: '注重数字素养提升，开设村民数字技能夜校，累计培训1.2万人次', status: 'hit', weight: 2 },
  ]),
], STANDARD)
const extras = withExtra.filter((m) => m.extra)
check('标准之外的点被标为 extra', extras.length === 1, `实际 ${extras.length} 条`)
check('extra 不计入主点统计（权重合计仍为 20）', summarizeKeyPoints(withExtra).weightSum === 20)
check('extra 在末尾（不插进标准点中间）', withExtra[withExtra.length - 1].extra === true)

// ══════════════════════════════════════════════════════════════
console.log('\n── 5. 无标准：按语义相似度聚类，同类措辞必须合并')
const noStd = mergeKeyPoints([
  teacher('yuandong', '袁东', [
    { point: '加强组织领导，成立领导小组，多部门参与', status: 'hit', weight: 4 },
    { point: '加大资金投入，设立专项资金并给予奖补', status: 'hit', weight: 3 },
  ]),
  teacher('zhoutairan', '周泰然', [
    { point: '强化组织领导，成立领导小组，多部门参与', status: 'partial', weight: 4 },
    { point: '推进智慧农业建设，培训新农人', status: 'hit', weight: 4 },
  ]),
], null)
check('相似措辞被合并（"加强组织领导" vs "强化组织领导"）', noStd.length === 3, `实际 ${noStd.length} 条`)
check('合并后 status 取最好', noStd[0].status === 'hit', `实际 ${noStd[0].status}`)
check('合并后 weight 取众数（两位都给 4 分）', noStd[0].weight === 4, `实际 ${noStd[0].weight}`)
check('sources 记录了两位老师', noStd[0].sources.length === 2, JSON.stringify(noStd[0].sources))

// ══════════════════════════════════════════════════════════════
console.log('\n── 6. 反例：不相似的必须**不能**被合并（防过度归并）')
const distinct = mergeKeyPoints([
  teacher('yuandong', '袁东', [
    { point: '加强组织领导，成立领导小组', status: 'hit', weight: 4 },
    { point: '发展农村电商，建设县域公共服务中心，统一品牌包装物流', status: 'hit', weight: 3 },
    { point: '创新乡村治理，开发微治理小程序，实现自动派单', status: 'hit', weight: 3 },
  ]),
], null)
check('三个不同要点不被误合并', distinct.length === 3, `实际 ${distinct.length} 条`)

// ══════════════════════════════════════════════════════════════
console.log('\n── 7. 边界：空输入 / 解析失败的老师 / 缺字段')
check('空数组返回空数组', mergeKeyPoints([], STANDARD).length === 6, '（有标准时仍应列出全部 miss 点）')
check('无标准 + 空输入 → 空数组', mergeKeyPoints([], null).length === 0)
const withErr = mergeKeyPoints([
  { teacherId: 'x', teacherName: 'X', error: '解析失败', keyPoints: [] },
  teacher('yuandong', '袁东', [{ point: '加强组织领导，成立领导小组', status: 'hit', weight: 4 }]),
], null)
check('解析失败的老师不参与归并', withErr.length === 1, `实际 ${withErr.length} 条`)
check(
  'point 为空白的条目被丢弃',
  mergeKeyPoints([teacher('a', 'A', [{ point: '   ', status: 'hit', weight: 1 }, { point: '有效要点内容', status: 'hit', weight: 1 }])], null).length === 1
)
check('缺 status 时按 miss 兜底', mergeKeyPoints([teacher('a', 'A', [{ point: '某个有效要点', weight: 2 }])], null)[0].status === 'miss')

// ══════════════════════════════════════════════════════════════
console.log('\n── 8. UC：weight 缺失时不会把权重合计算崩')
const noWeight = mergeKeyPoints([teacher('a', 'A', [{ point: '加强组织领导，成立领导小组', status: 'hit' }])], null)
check('weight 缺失时归为 0，不产生 NaN', noWeight[0].weight === 0 && Number.isFinite(noWeight[0].earned))

// ══════════════════════════════════════════════════════════════
console.log('\n── 9. summarize 的 hitCount 是真数字（不是数组长度）')
const summary = summarizeKeyPoints(merged)
check('hit + partial + miss == total', summary.hit + summary.partial + summary.miss === summary.total,
  `${summary.hit}+${summary.partial}+${summary.miss} vs ${summary.total}`)
check('earnedSum 不超过 weightSum', summary.earnedSum <= summary.weightSum,
  `${summary.earnedSum} vs ${summary.weightSum}`)

// ══════════════════════════════════════════════════════════════
console.log('\n── 10. 阈值自检：SIMILARITY_THRESHOLD 落在合理区间')
check('阈值在 0.4~0.7 之间（太低会误合并，太高会漏合并）',
  SIMILARITY_THRESHOLD >= 0.4 && SIMILARITY_THRESHOLD <= 0.7, `实际 ${SIMILARITY_THRESHOLD}`)

// ══════════════════════════════════════════════════════════════
console.log('\n── 11. 回归：真数据里踩到的「一句话说两个点」')
// 这条来自 2026-09-18 第一次真实批改（三师 glm-4-flash）：
// 周泰然那句同时命中了 p1（领导小组/部门参与）和 p2（专项资金/奖补），
// ①-b 的「最像」匹配把它独占给 p1，①-c 的追加归属门槛又要求命中 3 个关键词，
// 于是 p2 永远等不到人、被错判成 miss。**这个 case 必须锁死。**
const dualPoint = mergeKeyPoints([
  teacher('zhoutairan', '周泰然', [
    { point: '省级统筹，成立领导小组，16部门参与，建立调度考核机制；年设专项资金并奖补', status: 'hit', weight: 4 },
  ]),
], STANDARD)
const dual1 = dualPoint.find((m) => m.standardId === 'p1')
const dual2 = dualPoint.find((m) => m.standardId === 'p2')
check('一句话里的两个点都被认领（p1 和 p2）', !!dual1?.sources.length && !!dual2?.sources.length,
  `p1=${JSON.stringify(dual1?.sources)} p2=${JSON.stringify(dual2?.sources)}`)
check('追加归属的 p2 未被错判为 miss', dual2?.status !== 'miss', `实际 ${dual2?.status}`)

// ══════════════════════════════════════════════════════════════
console.log('\n── 12. 回归：老师全挂但标准存在时，标准点仍要列出来')
// API 挂了 / 模型全解析失败时 flat 为空。早期实现里有 `if (!flat.length) return []`，
// 于是最需要这份标准的时刻，页面上一片空白。
const allFailed = mergeKeyPoints([
  { teacherId: 'a', teacherName: 'A', error: '解析失败', keyPoints: [] },
  { teacherId: 'b', teacherName: 'B', error: '网络错误', keyPoints: [] },
], STANDARD)
check('老师全挂时仍列出全部标准点', allFailed.length === 6, `实际 ${allFailed.length} 条`)
check('全部标为 miss', allFailed.every((m) => m.status === 'miss'))
check('权重合计仍是标准的 20 分', summarizeKeyPoints(allFailed).weightSum === 20)

// ---------- 汇总 ----------
const failed = results.filter((r) => !r.ok)
console.log(`\n${'─'.repeat(60)}`)
console.log(`共 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
if (failed.length) {
  console.log('\n失败项：')
  failed.forEach((f) => console.log(`  ✗ ${f.name}`))
  process.exit(1)
}
console.log('全部通过 ✓')
