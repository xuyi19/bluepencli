// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 题库汇编导出（v2 · 目录树版）：
// 不再是几个大 md 平铺，而是按「考试体系 → 年份 → 卷别」分目录，
// 每套卷独立两个文档（材料.md / 参考答案.md），以后加省考卷不挤在一个文件里。
//
//   node .tools/export-bank-docs.mjs                 # 公开卷（2010–2021）→ docs/题库汇编/
//   node .tools/export-bank-docs.mjs --private       # 追加私有卷（2022+）→ 私有题库/汇编/
//
// 产出结构（示例）：
//   docs/题库汇编/
//   ├── README.md                    # 总索引（全卷表格 + 链接）
//   └── 国考/
//       ├── 2010/
//       │   ├── 省部级/{材料.md, 参考答案.md}
//       │   └── 地市级/{材料.md, 参考答案.md}
//       └── 2021/...
//
// ⚠️ 两条铁律（不变）：
//   ① 采分点 / 评分细则**永不导出**。写出采分点＝泄题，它们只活在程序内的
//      data/standards/（批改时注入），不随任何文档外发。
//   ② 私有卷默认不导。--private 只写进 `私有题库/汇编/`（整目录 gitignored），
//      写之前先校验 .gitignore 真的盖住该目录，盖不住就拒跑。

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PUBLIC_DIR = path.join(ROOT, 'frontend/src/data/real-exams')
const PRIVATE_DIR = path.join(ROOT, 'frontend/src/data/real-exams-private')
const PUBLIC_OUT = path.join(ROOT, 'docs/题库汇编')
const PRIVATE_OUT = path.join(ROOT, '私有题库/汇编')

const { splitMaterialBlocks } = await import('../frontend/src/utils/grading/materialTrim.js')

const argv = process.argv.slice(2)
const withPrivate = argv.includes('--private')

/** 卷别排序：地市级 → 省部级/省级 → 行政执法 → 其余垫底 */
const PAPER_ORDER = { 地市级: 0, 省部级: 1, 省级: 1, 行政执法: 2 }
function paperRank(p) {
  return PAPER_ORDER[String(p || '')] ?? 9
}

/**
 * 考试体系归类（目录第一层）。现在题库里只有国考；
 * 以后导省考卷时在这里扩展：按 title 中的省份名归到 `省考-XX`。
 */
function examSystem(p) {
  const t = String(p.title || '')
  if (/国家|国考/.test(t)) return '国考'
  // 预留：if (/广东/.test(t)) return '省考-广东'
  return '其他'
}

/** 解析一份 exam-*.js（`export default {…JSON…}`）成对象 */
function parsePaper(file) {
  const s = readFileSync(file, 'utf8')
  const i = s.indexOf('export default')
  if (i < 0) throw new Error(`${file} 里没有 export default`)
  return JSON.parse(s.slice(i + 14).trim())
}

function loadPapers(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^exam-\d+.*\.js$/.test(f))
    .map((f) => parsePaper(path.join(dir, f)))
    .sort((a, b) => a.year - b.year || paperRank(a.paper) - paperRank(b.paper))
}

const now = new Date().toISOString().slice(0, 10)
const HEAD_NOTE =
  `> 生成于 ${now}。本汇编只含**题面材料**与**参考答案**；\n` +
  `> 采分点与评分细则不在此列，也不会出现在任何导出文档里。\n`

/**
 * 导出一套卷 → <outDir>/<体系>/<年>/<卷别>/{材料.md, 参考答案.md}
 * 返回 { matRel, refRel } 相对 outDir 的路径（供总索引链接）。
 */
function exportOnePaper(p, outDir) {
  const sys = examSystem(p)
  const dir = path.join(outDir, sys, String(p.year), String(p.paper || '未分卷'))
  mkdirSync(dir, { recursive: true })

  // ── 材料.md ──
  let mat = `# ${p.title} · 材料汇编\n\n${HEAD_NOTE}\n`
  const blocks = splitMaterialBlocks(p.material || '')
  if (!blocks.length) {
    mat += `> （该卷材料为空）\n`
  } else {
    for (const b of blocks) mat += `## ${b.label || '材料'}\n\n${b.body}\n\n`
  }
  const matRel = path.join(sys, String(p.year), String(p.paper || '未分卷'), '材料.md')
  writeFileSync(path.join(dir, '材料.md'), mat, 'utf8')

  // ── 参考答案.md ──
  let ref = `# ${p.title} · 参考答案\n\n${HEAD_NOTE}\n`
  for (const q of p.questions) {
    const wl = q.wordLimit ? ` · ≤${q.wordLimit}字` : ''
    ref += `## 第${q.no}题 · ${q.type || '未标注题型'}（${q.score}分${wl}）\n\n`
    ref += `**题干**：${q.stem}\n\n`
    if (q.requirement) ref += `**要求**：${q.requirement}\n\n`
    ref += `**参考答案**\n\n${(q.reference || '（该卷参考答案缺失）').trim()}\n\n`
  }
  const refRel = path.join(sys, String(p.year), String(p.paper || '未分卷'), '参考答案.md')
  writeFileSync(path.join(dir, '参考答案.md'), ref, 'utf8')

  return { matRel, refRel, matLen: mat.length, refLen: ref.length }
}

/** 重建输出目录（旧的平铺版有 3 个大 md，先整个清掉避免新旧混杂） */
function resetOutDir(outDir) {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
}

/** 生成根 README 总索引 */
function writeIndex(papers, entries, outDir, { tierLabel }) {
  const years = [...new Set(papers.map((p) => p.year))].sort((a, b) => a - b)
  const qCount = papers.reduce((n, p) => n + p.questions.length, 0)
  let idx =
    `# 蓝笔申论 · 题库汇编\n\n` +
    `> ${tierLabel} · 共 ${papers.length} 套 / ${qCount} 题（${years[0]}–${years[years.length - 1]}）· 生成于 ${now}\n\n` +
    `每套卷一个目录（体系/年份/卷别），含 **材料.md** 与 **参考答案.md**。\n` +
    `练习时程序默认只展示本题引用的那几则材料（v0.17.0 起按题裁材料），本汇编保留整卷便于通读。\n\n` +
    `## 什么没有在这里\n\n` +
    `**采分点 / 评分细则**。它们属于"标准层"，写出采分点等于泄题，只随批改过程注入，不落任何导出文档。\n\n`

  // 按体系 → 年份分组列表
  const systems = [...new Set(papers.map((p) => examSystem(p)))]
  for (const sys of systems) {
    idx += `## ${sys}\n\n`
    const sysPapers = papers.filter((p) => examSystem(p) === sys)
    const sysYears = [...new Set(sysPapers.map((p) => p.year))].sort((a, b) => a - b)
    for (const y of sysYears) {
      idx += `### ${y} 年\n\n| 卷别 | 题数 | 材料字数 | 材料 | 参考答案 |\n|---|---|---|---|---|\n`
      for (const p of sysPapers.filter((x) => x.year === y)) {
        const e = entries.get(p)
        idx +=
          `| ${p.paper} | ${p.questions.length} | ${(p.material || '').length}` +
          ` | [材料.md](${encodeURI(e.matRel)}) | [参考答案.md](${encodeURI(e.refRel)}) |\n`
      }
      idx += `\n`
    }
  }

  idx += `## 私有卷说明\n\n`
  if (tierLabel.includes('公开')) {
    idx += `不随软件内置，由题库包（.bpq）定向分发；导入后在题库页可见。管理端：\`node .tools/admin-bank.mjs\`。\n`
  } else {
    idx += `本目录下的内容来自私有题库，**仅供本人查看，请勿外传**。本目录已被 .gitignore 整目录排除。\n`
  }
  writeFileSync(path.join(outDir, 'README.md'), idx, 'utf8')
  return idx
}

/** 私密资产出库前的硬校验：.gitignore 必须整目录盖住目标 */
function assertGitignored(relDir) {
  const gi = readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  const top = relDir.split('/')[0]
  if (!gi.split(/\r?\n/).some((l) => l.trim() === top + '/')) {
    throw new Error(`.gitignore 里没有整目录规则「${top}/」，拒绝导出私有材料（防泄密硬校验）`)
  }
}

/** 导出一组卷并打印统计，返回 {count, qCount, idxLen} */
function exportBatch(papers, outDir, label) {
  resetOutDir(outDir)
  const entries = new Map()
  let qCount = 0
  for (const p of papers) {
    const e = exportOnePaper(p, outDir)
    entries.set(p, e)
    qCount += p.questions.length
  }
  const idx = writeIndex(papers, entries, outDir, { tierLabel: label })
  const sysCount = new Set(papers.map((p) => examSystem(p))).size
  console.log(`✓ ${papers.length} 套 / ${qCount} 题 → ${path.relative(ROOT, outDir)}/（${sysCount} 个体系，每卷 材料.md + 参考答案.md，README 总索引 ${idx.length} 字符）`)
  return { count: papers.length, qCount }
}

// ────────────────────────────── main
const publicPapers = loadPapers(PUBLIC_DIR)
if (!publicPapers.length) {
  console.error('公开卷目录是空的，先跑 .tools/exams/to_frontend.py')
  process.exit(1)
}
exportBatch(publicPapers, PUBLIC_OUT, '公开卷 2010–2021 国考')

if (withPrivate) {
  assertGitignored('私有题库/汇编')
  const priv = loadPapers(PRIVATE_DIR)
  if (!priv.length) {
    console.log('· 本机没有私有卷源（real-exams-private/ 为空），跳过 --private')
  } else {
    exportBatch(priv, PRIVATE_OUT, '私有卷 2022–2024 国考 · 请勿外传')
    console.log('  ⚠️ 私有汇编只在本机看，发人走 .bpq 加密包，别发明文文档。')
  }
}
