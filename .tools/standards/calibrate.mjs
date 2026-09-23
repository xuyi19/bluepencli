// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 采分点校准工作台（V4 · 本地校准+预解析向导的第一块）
//
//   node .tools/standards/calibrate.mjs --list          # 覆盖盘点：谁有标准、来源、缺哪些
//   node .tools/standards/calibrate.mjs --check         # 校验全部标准（分值/结构）
//   node .tools/standards/calibrate.mjs --wizard <id>   # 交互录入/修订一题的采分点
//
// 产出写入 frontend/src/data/standards/manual.json（由 index.js 以最高人工优先级合并）。
// **不动 public.js / generated.js 这两个源文件** —— 手改对象字面量容易写坏，
// 工作台只写自己那份 JSON，且每次写之前先备份。
//
// ⚠️ 采分点是泄题级数据：写进 public/manual 的就是**公开库**标准（≤2021 与仿真题）；
//    私有卷（≥2022）的标准走 standards-private/，别在这里录。

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const STD_DIR = path.join(ROOT, 'frontend/src/data/standards')
const MANUAL = path.join(STD_DIR, 'manual.json')

const argv = process.argv.slice(2)
const flag = (n) => argv.indexOf('--' + n)
const val = (n) => {
  const i = flag(n)
  return i >= 0 ? argv[i + 1] : undefined
}

// ── 读标准（ESM 源直接 import；manual 是 JSON） ──
const { PUBLIC_STANDARDS } = await import(pathToFileURL(path.join(STD_DIR, 'public.js')).href)
const { GENERATED_STANDARDS } = await import(pathToFileURL(path.join(STD_DIR, 'generated.js')).href)
const manual = JSON.parse(readFileSync(MANUAL, 'utf8'))
const all = { ...GENERATED_STANDARDS, ...PUBLIC_STANDARDS, ...manual }
const isManual = (id) => Object.prototype.hasOwnProperty.call(manual, id)
const sourceOf = (id) =>
  isManual(id) ? '工作台' : PUBLIC_STANDARDS[id] ? '仓库精校' : GENERATED_STANDARDS[id] ? '批量生成' : '—'

/** 覆盖优先级表：工作台 > 仓库精校 > 批量生成 */
function effective(id) {
  return all[id] || null
}

// ── 题目清单（公开题库：真题 + 仿真，用于盘点覆盖率） ──
async function questionIndex() {
  const { EXAM_INDEX } = await import(pathToFileURL(path.join(ROOT, 'frontend/src/data/real-exams/index.js')).href)
  const { BUILTIN_QUESTIONS } = await import(pathToFileURL(path.join(ROOT, 'frontend/src/data/builtin-questions.js')).href)
  const rows = []
  for (const e of EXAM_INDEX) {
    for (const q of e.questions) rows.push({ id: `real-${e.id}-${q.no}`, title: q.stem, exam: `${e.year} ${e.paper}` })
  }
  // questions.js 对仿真题统一加 builtin- 前缀，标准表也用这个 id
  for (const q of BUILTIN_QUESTIONS) {
    rows.push({ id: 'builtin-' + q.id, title: q.title || q.stem, exam: '仿真' })
  }
  return rows
}

// ── ① 覆盖盘点 ──
async function cmdList() {
  const qs = await questionIndex()
  const withStd = qs.filter((q) => effective(q.id))
  const bySrc = {}
  for (const q of withStd) bySrc[sourceOf(q.id)] = (bySrc[sourceOf(q.id)] || 0) + 1
  console.log(`题库题目 ${qs.length} 道 ｜ 有标准 ${withStd.length} 道（覆盖 ${((withStd.length / qs.length) * 100).toFixed(1)}%）`)
  for (const [k, v] of Object.entries(bySrc)) console.log(`  ${k.padEnd(6)} ${v} 道`)

  const missing = qs.filter((q) => !effective(q.id))
  console.log(`\n缺标准 ${missing.length} 道（优先补这些，先看近年卷）`)
  for (const q of missing.slice(-12)) console.log(`  ${q.id}  ${q.exam}  ${String(q.title).slice(0, 34)}`)
  if (missing.length > 12) console.log(`  …（共 ${missing.length} 道）`)
  console.log('\n录入：node .tools/standards/calibrate.mjs --wizard <题目id>')
}

// ── ② 校验 ──
function cmdCheck() {
  const problems = []
  for (const [id, st] of Object.entries(all)) {
    if (id.startsWith('_')) continue
    if (!Array.isArray(st.points) || !st.points.length) {
      problems.push(`${id}: 没有采分点`)
      continue
    }
    const wsum = st.points.reduce((n, p) => n + (Number(p.weight) || 0), 0)
    if (st.totalScore && wsum !== st.totalScore) {
      problems.push(`${id}: 权重合计 ${wsum} ≠ 题分 ${st.totalScore}`)
    }
    const ids = st.points.map((p) => p.id)
    if (new Set(ids).size !== ids.length) problems.push(`${id}: 采分点 id 重复`)
    for (const p of st.points) {
      if (!p.label) problems.push(`${id}/${p.id}: 缺 label`)
      if (!Number(p.weight)) problems.push(`${id}/${p.id}: 权重非正数`)
    }
  }
  console.log(`校验标准 ${Object.keys(all).filter((k) => !k.startsWith('_')).length} 条`)
  if (!problems.length) {
    console.log('✓ 全部通过（权重与题分一致、id 唯一、字段齐全）')
    return
  }
  for (const p of problems.slice(0, 30)) console.log(`  ⚠ ${p}`)
  if (problems.length > 30) console.log(`  …（共 ${problems.length} 处）`)
}

// ── ③ 交互向导 ──
async function cmdWizard(id) {
  // 向导要交互式终端：管道/后台跑时 stdin 关闭会让 readline 的 promise 永远挂着，
  // 表现是"卡住不报错"——比直接拒绝难排查，宁可先说清楚。
  if (!input.isTTY) {
    console.error('✗ --wizard 需要交互式终端（管道或后台运行时 stdin 会立刻关闭）。')
    console.error('  在终端里直接跑：node .tools/standards/calibrate.mjs --wizard <题目id>')
    process.exit(1)
  }
  const qs = await questionIndex()
  const q = qs.find((x) => x.id === id)
  if (!q) {
    console.error(`✗ 题库里没有题目 ${id}。用 --list 看缺哪些。`)
    process.exit(1)
  }
  const cur = effective(id)
  const rl = createInterface({ input, output })
  const ask = async (prompt, def = '') => {
    const s = await rl.question(`${prompt}${def ? `（回车沿用「${def}」）` : ''}\n> `)
    return (s || '').trim() || def
  }

  console.log(`\n校准：${id}  ${q.exam}`)
  console.log(`题干：${String(q.title).slice(0, 60)}`)
  console.log(`现有：${cur ? `${cur.points.length} 个采分点（来源 ${sourceOf(id)}）` : '（无，新建）'}\n`)

  const totalScore = Number(await ask('该题满分', String(cur?.totalScore || 20))) || 20
  const points = []
  const seed = cur?.points || []
  let n = 0
  console.log('逐条录入采分点（label 留空结束）：')
  while (true) {
    const seedP = seed[n]
    const label = await ask(`\n[${n + 1}] 采分点`, seedP?.label || '')
    if (!label) break
    const weight = Number(await ask(`    权重（分）`, String(seedP?.weight ?? ''))) || 0
    const kw = await ask('    关键词（逗号分隔）', (seedP?.keywords || []).join(','))
    const ev = await ask('    材料依据（逗号分隔，可空）', (seedP?.evidence || []).join(','))
    const note = await ask('    给分说明（可空）', seedP?.note || '')
    points.push({
      id: seedP?.id || `p${n + 1}`,
      label,
      weight,
      keywords: kw ? kw.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [],
      evidence: ev ? ev.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [],
      note,
    })
    n++
  }
  rl.close()

  if (!points.length) {
    console.log('没有录入任何采分点，已取消。')
    return
  }
  const wsum = points.reduce((a, p) => a + p.weight, 0)
  if (wsum !== totalScore) console.log(`⚠ 权重合计 ${wsum} ≠ 题分 ${totalScore}（仍会保存，建议对齐）`)

  // 写盘前备份
  const stamp = new Date().toISOString().slice(0, 10)
  copyFileSync(MANUAL, MANUAL.replace(/\.json$/, `.bak-${stamp}.json`))
  const next = { ...manual }
  next[id] = {
    questionId: id,
    source: 'manual',
    totalScore,
    meta: { note: `工作台校准 ${stamp}`, version: '1.0', calibratedAt: stamp },
    points,
  }
  writeFileSync(MANUAL, JSON.stringify(next, null, 2), 'utf8')
  console.log(`\n✓ 已写入 manual.json：${id}（${points.length} 个采分点，权重 ${wsum} / ${totalScore}）`)
  console.log('  备份：manual.bak-<日期>.json ｜ 生效：重跑前端即可（index.js 里 manual 优先级最高）')
}

// ── main ──
if (flag('list') >= 0) await cmdList()
else if (flag('check') >= 0) cmdCheck()
else if (flag('wizard') >= 0) await cmdWizard(val('wizard'))
else {
  console.log(`用法：
  node .tools/standards/calibrate.mjs --list           # 覆盖盘点
  node .tools/standards/calibrate.mjs --check          # 校验全部标准
  node .tools/standards/calibrate.mjs --wizard <题目id> # 交互录入采分点

⚠️ 本工具写的是**公开库**标准（≤2021 与仿真题）。私有卷（≥2022）的标准走 standards-private/。`)
}
