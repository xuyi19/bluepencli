// M4 精读训练 · 找点匹配器纯函数层的护栏。
//
// 这个匹配器输出的是「找点得分率」—— 它是给用户看的**成绩单**，
// 判错的症状是"看起来合理的错数"：命中被算漏、误划被算对、权重加错。
// 用户会据此调整学习动作，错一个百分点都是误导。
//
// 2026-10-10 判定从二值改三级（full 全分 / partial 半分 / miss），
// 改的是"划个词就算全中"与"划了核心短语却漏判"两个老毛病。
// 旧断言里"42% 不命中"按新需求改为"partial"——需求变了，
// 钉着旧需求的绿护栏就是假护栏。
//
// 断言盯五类失败：
//   ① 分级边界（50% / 25% 两条线、关键词兜底）—— 每条线都有反例
//   ② 关键词/短片段**不得**越过证据位置去全材料匹配（划错地方被洗成"找对了" = 训练失效）
//   ③ 加权得分率：full 全分、partial 半分、按分值加权
//   ④ 宽划统计：远超证据长度的"蒙式划法"要被点名（但不扣分）
//   ⑤ 空入参 / 证据缺失不炸、不静默产出满分
//
// UI 链路（划句→色板→对照按钮→结果渲染）由 probe-read-ui.mjs 覆盖。
//
// 用法：node .tools/test-read-match.mjs

import { matchMarksToPoints, buildMissedOverlay } from '../frontend/src/utils/grading/pointMatch.js'
import { countOccurrences } from '../frontend/src/utils/highlight.js'

let failed = 0
const check = (label, ok, extra = '') => {
  if (ok) console.log(`  ✅ ${label}`)
  else {
    console.error(`  ❌ ${label}${extra ? ' — ' + extra : ''}`)
    failed++
  }
}

// 测试标准：两个点，4 分 + 1 分，总分 5
const POINTS = [
  {
    id: 'p1', label: '组织保障', weight: 4,
    evidence: ['成立数字乡村建设领导小组'],
    keywords: ['领导小组', '实绩考核'],
  },
  {
    id: 'p2', label: '资金支持', weight: 1,
    evidence: ['设立省级专项资金'],
    keywords: ['专项资金'],
  },
]
const MAT = '……县委县政府成立数字乡村建设领导小组，统筹推进各项工作。'
  + '省里设立省级专项资金予以支持。其他无关段落里也提到过领导小组三个字。'

console.log('full：两条全分规则')
{
  // 规则 1：标注 ⊇ 证据
  const r = matchMarksToPoints(
    [{ text: '县委县政府成立数字乡村建设领导小组，统筹推进各项工作。', nth: 0 }],
    POINTS)
  check('标注包含整条证据 → full', r.pointResults[0].hit && r.pointResults[0].grade === 'full')
  check('命中方式 cover', r.pointResults[0].matched[0]?.way === 'cover')
}
{
  // 规则 2：证据 ⊇ 标注 且 ≥50%
  const r = matchMarksToPoints([{ text: '成立数字乡村建设领导', nth: 0 }], POINTS)
  check('覆盖证据过半（10/13 ≈ 77%）→ full', r.pointResults[0].hit && r.pointResults[0].grade === 'full')
}

console.log('partial：半分规则与新 25% 线')
{
  // 42%（旧版不命中、新版 partial）：划了证据近半，找对地方没找全
  const r = matchMarksToPoints([{ text: '成立数字乡', nth: 0 }], POINTS)
  check('覆盖 42% → partial（旧版漏判，已修）',
    r.pointResults[0].hit && r.pointResults[0].grade === 'partial'
    && r.pointResults[0].matched[0]?.way === 'partial')
}
{
  // 25% 线边界：2/8 = 25% → partial；3/13 ≈ 23% 且无关键词 → miss
  const r1 = matchMarksToPoints([{ text: '专项', nth: 0 }], POINTS)
  check('覆盖恰好 25% → partial（边界含）',
    r1.pointResults[1].hit && r1.pointResults[1].grade === 'partial')
  // 25% 线边界外：2/12 ≈ 17% 且无关键词 → miss（证据 norm 后 12 字）
  const r2 = matchMarksToPoints([{ text: '成立', nth: 0 }], POINTS)
  check('覆盖 17% 且无关键词 → miss（边界外）', !r2.pointResults[0].hit)
}
{
  // 规则 4：覆盖 <25% 但含关键词 → partial（不再是 full）
  const r = matchMarksToPoints([{ text: '领导小组', nth: 0 }], POINTS)
  check('小片段含关键词 → partial', r.pointResults[0].hit && r.pointResults[0].grade === 'partial')
  check('命中方式 keyword 且带词', r.pointResults[0].matched[0]?.way === 'keyword'
    && r.pointResults[0].matched[0]?.keyword === '领导小组')
}

console.log('关键反例：关键词/短片段不得越过证据位置')
{
  // 材料后半段有"领导小组三个字"（不在证据所在句）。划它**不能**命中 p1 ——
  // 否则"划错地方"会被洗成"找对了"，找点训练就失去意义。
  const r = matchMarksToPoints([{ text: '其他无关段落里也提到过领导小组', nth: 0 }], POINTS)
  check('无关段落里的关键词 → 不命中', !r.pointResults[0].hit)
  check('该标注判为误划', r.stats.missMarks === 1)
}

console.log('加权得分率：full 全分 / partial 半分')
{
  // 只命中 p2（1 分，full：8/8 cover）→ 20%
  const r1 = matchMarksToPoints([{ text: '设立省级专项资金', nth: 0 }], POINTS)
  check('full 命中 1 分点 → 20%（不是按点数 50%）', r1.stats.scoreRate === 20,
    `实际 ${r1.stats.scoreRate}`)
  // p1 partial 半分：4 × 0.5 = 2 / 5 = 40%
  const r2 = matchMarksToPoints([{ text: '成立数字乡', nth: 0 }], POINTS)
  check('4 分点 partial → 40%（半分）', r2.stats.scoreRate === 40, `实际 ${r2.stats.scoreRate}`)
  // p2 partial 半分：1 × 0.5 = 0.5 / 5 = 10%
  const r3 = matchMarksToPoints([{ text: '专项', nth: 0 }], POINTS)
  check('1 分点 partial → 10%（半分）', r3.stats.scoreRate === 10, `实际 ${r3.stats.scoreRate}`)
  // full 命中 4 分点 → 80%
  const r4 = matchMarksToPoints([{ text: '成立数字乡村建设领导小组', nth: 0 }], POINTS)
  check('full 命中 4 分点 → 80%', r4.stats.scoreRate === 80, `实际 ${r4.stats.scoreRate}`)
  // 一条标注覆盖两个点（都 full）→ 100%
  const r5 = matchMarksToPoints(
    [{ text: '成立数字乡村建设领导小组，统筹推进各项工作。省里设立省级专项资金予以支持。', nth: 0 }], POINTS)
  check('一条标注覆盖两个点 → 100%', r5.stats.scoreRate === 100, `实际 ${r5.stats.scoreRate}`)
  check('一条标注同时记入两点的 matched', r5.markResults[0].hitPointIds.length === 2)
  // 分级计数
  check('fullPoints / partialPoints 计数',
    r5.stats.fullPoints === 2 && r5.stats.partialPoints === 0,
    `实际 ${r5.stats.fullPoints}/${r5.stats.partialPoints}`)
  const r6 = matchMarksToPoints([{ text: '领导小组', nth: 0 }], POINTS)
  check('partial 计入 hitPoints 且 partialPoints = 1',
    r6.stats.hitPoints === 1 && r6.stats.partialPoints === 1 && r6.stats.fullPoints === 0)
}

console.log('宽划统计：蒙式划法要点名（不扣分）')
{
  // 40 字标注踩中 13+8=21 字证据：40 ≤ 52.5 → 不算宽
  const r1 = matchMarksToPoints(
    [{ text: '成立数字乡村建设领导小组，统筹推进各项工作。省里设立省级专项资金予以支持。', nth: 0 }], POINTS)
  check('覆盖两点的长句不算宽划（2.5 倍线内）', r1.stats.wideMarks === 0)
  // 61 字标注只踩中 8 字证据：61 > 20 → 宽。
  // ⚠️ 造数必须与证据逐字一致（"设立省级"不是"设立了省级"——多一个字就不命中）
  const LONG = '县里成立了数字乡村建设的工作专班，同时要求各乡镇把数字乡村纳入年度重点任务，'
    + '并且设立省级专项资金予以支持，年底统一考核。'
  const r2 = matchMarksToPoints([{ text: LONG, nth: 0 }], POINTS)
  check('60 字标注只踩中 8 字证据 → 宽划 1', r2.stats.wideMarks === 1,
    `实际 ${r2.stats.wideMarks}（标注 ${LONG.length} 字）`)
  check('宽划照样得分（不扣分）', r2.pointResults[1].hit)
  // 未命中的长标注不重复背"宽"（它已经是误划）
  const r3 = matchMarksToPoints([{ text: '统筹推进各项工作，压实各方责任，形成工作合力，确保取得实效。', nth: 0 }], POINTS)
  check('未命中的长标注只算误划不算宽', r3.stats.missMarks === 1 && r3.stats.wideMarks === 0)
}

console.log('标注侧统计')
{
  const r = matchMarksToPoints([
    { text: '成立数字乡村建设领导小组', nth: 0 },   // 有效
    { text: '省里设立省级专项资金予以支持', nth: 0 }, // 有效
    { text: '统筹推进各项工作', nth: 0 },           // 误划（不在任何证据里）
  ], POINTS)
  check('有效 2 / 误划 1', r.stats.validMarks === 2 && r.stats.missMarks === 1,
    `实际 有效${r.stats.validMarks} 误划${r.stats.missMarks}`)
  check('总标注数 3', r.stats.totalMarks === 3)
}

console.log('空白归一化')
{
  // 真题材料/标注里常混换行与全角空格 —— 归一化后必须照样命中
  const r = matchMarksToPoints([{ text: '成立 数字\n乡村建设领导小组', nth: 0 }], POINTS)
  check('标注含空白仍命中（去空白比对）', r.pointResults[0].hit)
  const P2 = [{ ...POINTS[0], evidence: ['成立 数字 乡村建设领导小组'] }]
  const r2 = matchMarksToPoints([{ text: '成立数字乡村建设领导小组', nth: 0 }], P2)
  check('证据含空白也命中', r2.pointResults[0].hit)
}

console.log('空入参与缺失')
{
  const r0 = matchMarksToPoints([], POINTS)
  check('零标注 → 得分率 0、全部漏掉', r0.stats.scoreRate === 0 && r0.stats.hitPoints === 0)
  check('零标注不报 NaN', Number.isFinite(r0.stats.scoreRate))
  const r1 = matchMarksToPoints([{ text: '随便划一段', nth: 0 }], [])
  check('无标准点 → 得分率 0 不炸', r1.stats.scoreRate === 0 && r1.pointResults.length === 0)
  const r2 = matchMarksToPoints([{ text: '', nth: 0 }], POINTS)
  check('空文本标注 → 忽略且总标注数 0', r2.stats.totalMarks === 0)
}

console.log('漏点叠加层')
{
  const r = matchMarksToPoints([{ text: '设立省级专项资金', nth: 0 }], POINTS)
  const ov = buildMissedOverlay(MAT, r.pointResults, countOccurrences)
  check('漏掉的 p1 证据进了叠加层', ov.overlay.length === 1
    && ov.overlay[0].color === 'red'
    && ov.overlay[0].text === '成立数字乡村建设领导小组')
  // MAT 里确实有这句（countOccurrences > 0），missing 应为 0
  check('能定位到 → missing 0', ov.missing === 0)
  const ov2 = buildMissedOverlay('很短的材料', r.pointResults, countOccurrences)
  check('定位不到 → 进 missing 不静默', ov2.overlay.length === 0 && ov2.missing === 1)
  // 命中的点不进叠加层：一条标注同时覆盖两个点 → 全命中 → 叠加层为空
  const r2 = matchMarksToPoints(
    [{ text: '成立数字乡村建设领导小组，统筹推进各项工作。省里设立省级专项资金予以支持。', nth: 0 }], POINTS)
  const ov3 = buildMissedOverlay(MAT, r2.pointResults, countOccurrences)
  check('全命中的点不叠加', ov3.overlay.length === 0)
  // partial 命中的点不叠加（它已被找到，只是没找全）。
  // 注意：只划一处时另一个点（p2）必然漏掉，其证据**应该**进叠加层——
  // 所以断「p1 的证据不在叠加层」，不断「叠加层为空」。
  const r3 = matchMarksToPoints([{ text: '领导小组', nth: 0 }], POINTS)
  const ov4 = buildMissedOverlay(MAT, r3.pointResults, countOccurrences)
  check('partial 命中的点不叠加', ov4.overlay.every((o) => o.text !== '成立数字乡村建设领导小组'))
  check('同时漏掉的 p2 证据照常叠加', ov4.overlay.some((o) => o.text === '设立省级专项资金'))
}

process.exit(failed ? 1 : 0)
