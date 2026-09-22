// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 题库汇编导出：把真题的「材料」与「参考答案」各汇成一个 Markdown 文档，
// 按年份 → 考试分类，方便脱离程序翻看。
//
//   node .tools/export-bank-docs.mjs                 # 公开卷（2010–2021）→ docs/题库汇编/
//   node .tools/export-bank-docs.mjs --private       # 追加私有卷（2022+）→ 私有题库/汇编/
//
// ⚠️ 两条铁律：
//   ① 采分点 / 评分细则**永不导出**。标准分层原则：写出采分点＝泄题，
//      它们只活在程序内的 data/standards/（批改时注入），不随任何文档外发。
//   ② 私有卷默认不导。--private 只写进 `私有题库/汇编/`（整目录 gitignored），
//      写之前先校验 .gitignore 真的盖住该目录，盖不住就拒跑 ——
//      私密资产不能靠"记得别提交"活着。

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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

const pad = (s, n) => String(s).padEnd(n, ' ')
const now = new Date().toISOString().slice(0, 10)

/** 生成两个文档 + 一个索引，返回写入的文件路径 */
function exportPapers(papers, outDir, { tierLabel }) {
  mkdirSync(outDir, { recursive: true })

  const years = [...new Set(papers.map((p) => p.year))].sort((a, b) => a - b)
  const qCount = papers.reduce((n, p) => n + p.questions.length, 0)
  const head =
    `> 生成于 ${now} · ${tierLabel} · 共 ${papers.length} 套 / ${qCount} 题（${years[0]}–${years[years.length - 1]}）\n` +
    `> 本汇编只含**题面材料**与**参考答案**；采分点与评分细则不在此列，也不会出现在任何导出文档里。\n\n`

  // ── 文档一：材料汇编 ──
  let mat = `# 蓝笔申论 · 申论真题材料汇编\n\n${head}`
  for (const y of years) {
    mat += `## ${y} 年\n\n`
    for (const p of papers.filter((x) => x.year === y)) {
      mat += `### ${p.title}\n\n`
      const blocks = splitMaterialBlocks(p.material || '')
      if (!blocks.length) {
        mat += `> （该卷材料为空）\n\n`
        continue
      }
      for (const b of blocks) {
        mat += `#### ${b.label || '材料'}\n\n${b.body}\n\n`
      }
    }
  }

  // ── 文档二：参考答案汇编 ──
  let ref = `# 蓝笔申论 · 申论真题参考答案汇编\n\n${head}`
  for (const y of years) {
    ref += `## ${y} 年\n\n`
    for (const p of papers.filter((x) => x.year === y)) {
      ref += `### ${p.title}\n\n`
      for (const q of p.questions) {
        const wl = q.wordLimit ? ` · ≤${q.wordLimit}字` : ''
        ref += `#### 第${q.no}题 · ${q.type || '未标注题型'}（${q.score}分${wl}）\n\n`
        ref += `**题干**：${q.stem}\n\n`
        if (q.requirement) ref += `**要求**：${q.requirement}\n\n`
        ref += `**参考答案**\n\n${(q.reference || '（该卷参考答案缺失）').trim()}\n\n`
      }
    }
  }

  // ── 索引 ──
  let idx =
    `# 蓝笔申论 · 题库汇编索引\n\n${head}` +
    `| 年份 | 考试 | 卷别 | 题数 | 材料字数 |\n|---|---|---|---|---|\n`
  for (const p of papers) {
    idx += `| ${p.year} | 国考 | ${p.paper} | ${p.questions.length} | ${(p.material || '').length} |\n`
  }
  idx +=
    `\n## 这两个文档是什么\n\n` +
    `- **材料汇编.md**：每套卷的完整题面材料，按「材料N」分节。\n` +
    `- **参考答案汇编.md**：每题的题干、要求与参考答案，练习完再对答案。\n` +
    `- 练习时程序默认**只展示本题引用的那几则**（v0.17.0 起按题裁材料），本汇编保留整卷便于通读。\n\n` +
    `## 什么没有在这里\n\n` +
    `**采分点 / 评分细则**。它们属于"标准层"，写出采分点等于泄题，只随批改过程注入，不落任何导出文档。\n` +
    (tierLabel.includes('公开')
      ? `\n## 私有卷（${Math.max(...years) + 1} 年起）\n\n不随软件内置，由题库包（.bpq）定向分发；导入后在题库页可见。管理端：\`node .tools/admin-bank.mjs\`。\n`
      : `\n## ⚠️ 私有资产\n\n本目录下的内容来自私有题库，**仅供本人查看，请勿外传**。本目录已被 .gitignore 整目录排除。\n`)

  const files = {
    '材料汇编.md': mat,
    '参考答案汇编.md': ref,
    'README.md': idx,
  }
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(outDir, name), content, 'utf8')
  }
  return files
}

/** 私密资产出库前的硬校验：.gitignore 必须整目录盖住目标 */
function assertGitignored(relDir) {
  const gi = readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  const top = relDir.split('/')[0]
  if (!gi.split(/\r?\n/).some((l) => l.trim() === top + '/')) {
    throw new Error(`.gitignore 里没有整目录规则「${top}/」，拒绝导出私有材料（防泄密硬校验）`)
  }
}

// ────────────────────────────── main
const publicPapers = loadPapers(PUBLIC_DIR)
if (!publicPapers.length) {
  console.error('公开卷目录是空的，先跑 .tools/exams/to_frontend.py')
  process.exit(1)
}
const out = exportPapers(publicPapers, PUBLIC_OUT, { tierLabel: '公开卷 2010–2021 国考' })
console.log(`✓ 公开卷 → docs/题库汇编/`)
for (const [name, content] of Object.entries(out)) {
  console.log(`   ${pad(name, 18)}${content.length} 字符`)
}

if (withPrivate) {
  assertGitignored('私有题库/汇编')
  const priv = loadPapers(PRIVATE_DIR)
  if (!priv.length) {
    console.log('· 本机没有私有卷源（real-exams-private/ 为空），跳过 --private')
  } else {
    const pout = exportPapers(priv, PRIVATE_OUT, { tierLabel: '私有卷 2022–2024 国考 · 请勿外传' })
    console.log(`✓ 私有卷 → 私有题库/汇编/（gitignored）`)
    for (const [name, content] of Object.entries(pout)) {
      console.log(`   ${pad(name, 18)}${content.length} 字符`)
    }
    console.log('  ⚠️ 私有汇编只在本机看，发人走 .bpq 加密包，别发明文文档。')
  }
}
