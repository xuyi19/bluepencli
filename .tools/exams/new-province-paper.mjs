// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 省考卷源 JSON 骨架生成器（V4 · 用户导入工具链的第一块）
//
//   node .tools/exams/new-province-paper.mjs --province 广东 --code gd --year 2023 --paper 县级
//   node .tools/exams/new-province-paper.mjs --province 广东 --code gd --year 2023 --paper 县级 --fill  # 带示例题
//
// 产出：.tools/exams/out/<id>.json（与国考管线同一目录、同一格式）
//       → 之后照旧走 to_frontend.py（它会把整卷编进 real-exams-private/，
//          因为年份 ≥2022 私有分层；发布检查锁公开卷 = 24 套，省考卷必须走私有通道）
//       → 打包分发走 admin-bank.mjs pack，与国考私有卷同一条路。
//
// ⚠️ 纪律：本工具只生成**骨架**（字段合规、题目占位），内容必须作者自己填 ——
//    编造"省考真题"等于造假；材料与题干要从真实试卷录入。
//
// id 规则：<年>-<省code>-<卷别code>（全 ASCII，作文件名）；卷别code：
//   县级=xianji  县级以上=xianji  乡镇=xiangzhen  乡镇级=xiangzhen  行政执法=zhifax

import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? argv[i + 1] : undefined
}

const { examSystemOf, isProvincePaper, QUESTION_TYPES } = await import(
  pathToFileURL(path.join(ROOT, 'frontend/src/data/examSystem.js')).href
)

const province = arg('province')
const code = (arg('code') || '').toLowerCase()
const year = Number(arg('year'))
const paper = arg('paper')
const fill = argv.includes('--fill')

// ── 参数校验（错就明说，不猜） ──
const errors = []
if (!province || province.length < 2) errors.push('--province 必填（中文省名，如 广东）')
if (!/^[a-z]{2,12}$/.test(code)) errors.push('--code 必填（省名拼音，全小写字母，如 gd / guangdong）')
if (!Number.isInteger(year) || year < 2022 || year > 2100) errors.push('--year 必须 ≥2022（私有分层界线，公开通道锁死 24 套国考卷，省考卷一律走私有）')
if (!isProvincePaper(paper)) errors.push('--paper 必须是省考卷别：县级 / 县级以上 / 乡镇 / 乡镇级 / 行政执法')
if (errors.length) {
  console.error('✗ 参数有误：')
  for (const e of errors) console.error('   ' + e)
  console.error('\n示例：node .tools/exams/new-province-paper.mjs --province 广东 --code gd --year 2023 --paper 县级')
  process.exit(1)
}

const PAPER_CODE = { 县级: 'xianji', 县级以上: 'xianji', 乡镇: 'xiangzhen', 乡镇级: 'xiangzhen', 行政执法: 'zhifax' }
const id = `${year}-${code}-${PAPER_CODE[paper]}`
const system = `省考-${province}`
const outPath = path.join(HERE, 'out', `${id}.json`)

if (existsSync(outPath)) {
  console.error(`✗ ${path.relative(process.cwd(), outPath)} 已存在。换个卷别/年份，或确认后手动删掉旧的。`)
  process.exit(1)
}

// ── 题目占位（--fill 给 4 题示例骨架，否则 4 个空位） ──
// 省考常见结构：3~4 题 / 总分 100 / 乡镇卷贯彻执行偏多 —— 只是默认骨架，作者按真题改。
const sampleQ = (no, type, score, wl) => ({
  no,
  type,
  stem: fill ? `（示例题干占位·请替换为 ${year} 年${province}省考${paper}卷第 ${no} 题真实题干）` : '',
  requirement: '',
  score,
  wordLimit: wl,
})
const questions = [
  sampleQ(1, '归纳概括', 20, 300),
  sampleQ(2, '综合分析', 20, 300),
  sampleQ(3, '贯彻执行', 30, 500),
  sampleQ(4, '大作文', 30, 1000),
]

const doc = {
  id,
  year,
  system, // 显式声明体系：examSystemOf() 读到它就不再猜
  paper,
  title: `${year}年${province}省公务员考试《申论》（${paper}）`,
  tier: 'private',
  material: fill
    ? '材料1\n（示例占位·请录入真实材料，用「材料N」开头分则，materialTrim 靠它按题裁材料）\n\n材料2\n（……）'
    : '',
  materialChars: 0,
  questions,
}

// ── 写盘前的自检（与国考管线同口径） ──
const scoreSum = questions.reduce((n, q) => n + q.score, 0)
const warns = []
if (scoreSum !== 100) warns.push(`分值合计 ${scoreSum} ≠ 100（省考常见 100 分，按真题改）`)
for (const q of questions) {
  if (!QUESTION_TYPES.includes(q.type)) warns.push(`第 ${q.no} 题题型「${q.type}」不在五大类里（自由文本可用，但推荐逻辑/画像按已知题型对齐）`)
}

writeFileSync(outPath, JSON.stringify(doc, null, 2), 'utf8')
console.log(`✓ 骨架已生成：${path.relative(process.cwd(), outPath)}`)
console.log(`  体系=${system}（examSystemOf 识别：${examSystemOf(doc)}） id=${id} tier=${doc.tier}`)
for (const w of warns) console.log(`  ⚠ ${w}`)
console.log(`
下一步：
  1. 编辑 out/${id}.json —— 录入真实材料（材料N 分则）与题干/要求/分值/字数
  2. node .tools/exams/to_frontend.py            # 编进 real-exams-private/（≥2022 自动私有）
  3. node .tools/test-all.mjs                    # 回归
  4. 分发：node .tools/admin-bank.mjs pack ...   # 与国考私有卷同一条 .bpq 通道`)
