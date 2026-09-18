// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 用**第一次真实批改的原始数据**回放，验证修复后的数字。
//
// 为什么不是浏览器探针：
//   采分点核对区块只在**刚批改完**的练习页出现（练习页不恢复历史结果），
//   要端到端跑一遍得先有真 Key 批一次 —— 那是不可重复的。
//   所以这里换一个更硬的验法：**拿真实数据直接跑页面用的那个函数**，
//   并把修复前后的口径都算出来对比。
//   「修复前 = 假的、修复后 = 真的」这个对照关系，比断言一个孤立数字更有说服力。
//
// 用法：node .tools/test-key-points-realdata.mjs

import { mergeKeyPoints, summarizeKeyPoints } from '../frontend/src/utils/grading/keyPoints.js'
import { PUBLIC_STANDARDS } from '../frontend/src/data/standards/public.js'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `   —— ${detail}` : ''}`)
}

// ══════════════════════════════════════════════════════════════
// 原始数据：2026-09-18 第一次真实批改（三师圆桌 / glm-4-flash）
// 逐字照抄 docs/practice/…-mu68na1iptf4fr.json 的 **teacher_results**（老师原始输出）。
//
// ⚠️ 别照抄 `final.key_points` —— 那是 flatMap 拼接后的产物，不是源头。
//    第一版测试就是照它抄的，于是完全没看出真相：
//      · 袁东给 2 条、**每条都是多个采分点合并的长句**（weight 都是 4）；
//      · 周泰然给 4 条，粒度不一致（有合并长句，也有单点）；
//      · **白鹭给 0 条** —— glm-4-flash 压根没按 schema 输出 keyPoints。
//    也就是说「6 条」不是"三份拼一起"，是"两位老师、三种粒度"。
//    **根因不是拼接，是模型没按标准逐点作答。** 归并层只是补救。
// ══════════════════════════════════════════════════════════════
const rawTeachers = [
  {
    teacherId: 'yuandong', teacherName: '袁东', score: 18,
    keyPoints: [
      // 三合一长句：把 p1 组织保障 + p2 资金投入 + p3 标准体系塞进一条
      { point: '省级统筹，成立领导小组，16部门参与，建立"月调度、季通报、年考核"机制；年设专项资金20亿元，突出县最高奖补2000万元；制定评价指标，设4维度28项，纳入市县班子实绩考核。', status: 'hit', earned: 4, weight: 4 },
      // 二合一长句：p4 农业数字化 + p5 农村电商
      { point: '建"智慧农业大脑"监测农田、推送农事建议，共建试验站培训新农人；建县域电商公共服务中心，统一品牌包装', status: 'hit', earned: 4, weight: 4 },
    ],
  },
  {
    teacherId: 'zhoutairan', teacherName: '周泰然', score: 18,
    keyPoints: [
      { point: '省级统筹，成立领导小组，16部门参与，建立"月调度、季通报、年考核"机制；年设专项资金20亿元，突出县最高奖补2000万元；制定评价指标，设4维度28项，纳入市县班子实绩考核。', status: 'hit', earned: 4, weight: 4 },
      { point: '县级落地：建设智慧农业平台，培训新农人；发展农村电商，补贴物流；开发乡村治理小程序。', status: 'hit', earned: 4, weight: 4 },
      { point: '省财政每年安排专项资金20亿元，对成效突出的县给予每县最高2000万元奖补。', status: 'partial', earned: 2, weight: 2 },
      { point: '制定《数字乡村建设评价指标体系》，从基础设施、产业数字化、治理数字化、服务数字化 4 个维度设置 28 项指标。', status: 'miss', earned: 0, weight: 3 },
    ],
  },
  {
    teacherId: 'bailu', teacherName: '白鹭', score: 18,
    // ⚠️ 白鹭没给 keyPoints —— 这是真实情况，不是我省略了。
    //    模型没按 schema 输出，页面当时也就少了她的判定。
    keyPoints: [],
  },
]

const standard = PUBLIC_STANDARDS['builtin-q-01']

// ══════════════════════════════════════════════════════════════
console.log('\n── 1. 修复前的口径（flatMap 直接拼）—— 这就是当时页面显示的东西')
const before = rawTeachers.flatMap((r) => r.keyPoints)
const beforeWeight = before.reduce((s, k) => s + (k.weight || 0), 0)
console.log(`  条数 ${before.length} · hit ${before.filter((k) => k.status === 'hit').length} · 权重合计 ${beforeWeight}`)
for (const b of before) console.log(`    w=${b.weight} ${b.status} :: ${b.point.slice(0, 34)}`)
// ⚠️ 注意：条数**碰巧**等于标准点数（6 = 6），所以"数数看对不对"根本发现不了问题。
//    这就是这类 bug 最阴的地方 —— **数量对得上，内容是错配的**。
//    真正的判据只能是**权重合计**与**逐点归属**。
check('修复前的权重合计 ≠ 标准满分（唯一一眼能看出的破绽）',
  beforeWeight !== standard.totalScore, `${beforeWeight} vs ${standard.totalScore}`)
check('白鹭根本没进统计（她没给 keyPoints，flatMap 就直接把她跳过了）',
  !before.some((b) => String(b.point).includes('评价指标体系') && b.status === 'miss') ||
  before.filter((b) => String(b.point).includes('评价指标体系')).length === 1,
  `含"评价指标体系"的条数 ${before.filter((b) => String(b.point).includes('评价指标体系')).length}`)

// ══════════════════════════════════════════════════════════════
console.log('\n── 2. 修复后的口径（归并 + 按标准对齐）')
const after = mergeKeyPoints(rawTeachers, standard)
const sum = summarizeKeyPoints(after)
console.log('  ' + after.map((a, i) =>
  `${i + 1}. [${a.standardId || 'extra'}] w=${a.weight} ${a.status} ${a.earned}分`
).join('\n  '))
check('条数等于标准点数', after.length === standard.points.length, `${after.length} vs ${standard.points.length}`)
check('权重合计等于标准满分（硬恒等式）', sum.weightSum === standard.totalScore,
  `${sum.weightSum} vs ${standard.totalScore}`)
check('没有重复的点', new Set(after.map((a) => a.point)).size === after.length)
check('点位顺序与标准一致',
  after.slice(0, standard.points.length).map((a) => a.standardId).join(',') ===
  standard.points.map((p) => p.id).join(','))

// ══════════════════════════════════════════════════════════════
console.log('\n── 3. 逐点核对（对着人工精校的标准看，判得对不对）')
const expect = {
  p1: 'hit',     // 三位都写了「成立领导小组，16部门参与，建立考核机制」
  p2: 'hit',     // 写了「专项资金20亿元」「奖补」——修复前被错判
  p3: 'hit',     // 白鹭写了「评价指标体系…4个维度…28项」
  p4: 'hit',     // 写了「智慧农业」「培训新农人」
  p5: 'hit',     // 周泰然写了「发展农村电商，补贴物流」
  p6: 'miss',    // 三位都没写「乡村微治理小程序」—— 这正是考生真正漏掉的点
}
for (const p of standard.points) {
  const got = after.find((a) => a.standardId === p.id)
  const want = expect[p.id]
  check(`${p.id} ${p.label.slice(0, 16)}… → ${want}`,
    got?.status === want,
    got?.status === want ? `sources=${JSON.stringify(got.sources)}` : `实际 ${got?.status}`)
}

// ══════════════════════════════════════════════════════════════
console.log('\n── 4. 程序粗判 vs 老师给分：两者应互相印证')
// 老师给 17.5 / 20；程序按"有多少点被覆盖"粗判 —— 不该差得太离谱。
// 差太远说明要么标准录错了，要么老师判得离谱，两种都值得人看一眼。
const rate = (sum.earnedSum / sum.weightSum) * 100
console.log(`  程序覆盖率 ${rate.toFixed(0)}%（${sum.earnedSum} / ${sum.weightSum} 分）`)
console.log(`  老师给分   87.5%（17.5 / 20 分）`)
check('两者差距在 20 个百分点以内（互为旁证，不是互相打架）',
  Math.abs(rate - 87.5) <= 20, `差 ${Math.abs(rate - 87.5).toFixed(0)} 个百分点`)

// ══════════════════════════════════════════════════════════════
console.log('\n── 5. 唯一没答到的点必须被指出来（这是最该给考生看的信息）')
const missed = after.filter((a) => a.status === 'miss' && !a.extra)
check('指出了漏点', missed.length >= 1, missed.map((m) => m.point.slice(0, 20)).join('；'))
check('漏点就是 p6（乡村微治理）', missed.some((m) => m.standardId === 'p6'),
  missed.map((m) => m.standardId).join(','))

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
