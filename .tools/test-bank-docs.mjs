// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 题库汇编导出的护栏测试（v2 · 目录树版）。跑法：
//   node .tools/test-bank-docs.mjs
//
// 四件事：
//   ① 结构对账：目录树里的卷目录数/题数与题库源一致（少一个目录 = 有卷没导出来）；
//   ② **采分点泄漏检查**：把 standards 文件里所有引号字符串当"指纹"，
//      逐条断言不出现在任何导出 md 里 —— 导出工具以后哪怕被改坏，
//      只要敢把标准写进文档，这里就红；
//   ③ 边界：公开汇编树里不得出现私有卷年份（2022+）；
//   ④ 私有汇编只能待在 gitignored 目录。
//
// ⚠️ 同源教训：扫描目录先想子层级 —— 这里显式按 体系/年/卷别/ 两级目录
//    遍历 md，不假设固定文件名平铺。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DOC_DIR = path.join(ROOT, 'docs/题库汇编')
const STANDARDS_DIR = path.join(ROOT, 'frontend/src/data/standards')
const PRIVATE_DIR = path.join(ROOT, 'frontend/src/data/real-exams-private')

let pass = 0
let fail = 0
function ok(cond, name, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${extra ? ' —— ' + extra : ''}`)
  }
}

/** 递归收集目录下所有 .md（返回绝对路径数组） */
function walkMd(dir) {
  const out = []
  for (const f of readdirSync(dir)) {
    const full = path.join(dir, f)
    if (statSync(full).isDirectory()) out.push(...walkMd(full))
    else if (f.endsWith('.md')) out.push(full)
  }
  return out
}

// ── ① 结构对账：直接从卷源重新数一遍，别用记忆里的 24/119
function parsePaper(file) {
  const s = readFileSync(file, 'utf8')
  const i = s.indexOf('export default')
  return JSON.parse(s.slice(i + 14).trim())
}
const papers = readdirSync(path.join(ROOT, 'frontend/src/data/real-exams'))
  .filter((f) => /^exam-\d+.*\.js$/.test(f))
  .map((f) => parsePaper(path.join(ROOT, 'frontend/src/data/real-exams', f)))
const paperCount = papers.length
const questionCount = papers.reduce((n, p) => n + p.questions.length, 0)

console.log(`\n① 结构对账（源：${paperCount} 套 / ${questionCount} 题）`)
const allMd = walkMd(DOC_DIR)
const rels = allMd.map((f) => path.relative(DOC_DIR, f).replaceAll('\\', '/'))
ok(allMd.filter((f) => path.basename(f) === '材料.md').length === paperCount, '材料.md 数 = 卷数')
ok(allMd.filter((f) => path.basename(f) === '参考答案.md').length === paperCount, '参考答案.md 数 = 卷数')

// 每卷目录 = 体系/年/卷别，材料里必须含卷标题；目录里必须有成对两个文档
const refQ = /(?<=^|\n)## 第\d+题/g
let totalQ = 0
let missingTitle = ''
for (const p of papers) {
  const dirRel = rels.find((r) => r.includes(`/${p.year}/`) && path.basename(path.dirname(r)) === String(p.paper) && r.endsWith('材料.md'))
  if (!dirRel) {
    ok(false, `缺卷目录：${p.year}/${p.paper}`)
    break
  }
  const mat = readFileSync(path.join(DOC_DIR, dirRel), 'utf8')
  if (!mat.includes(p.title)) {
    missingTitle = `${p.year}/${p.paper}（应含「${p.title}」）`
    break
  }
  const refRel = dirRel.replace('材料.md', '参考答案.md')
  if (!rels.includes(refRel)) {
    ok(false, `缺参考答案.md：${refRel}`)
    break
  }
  totalQ += (readFileSync(path.join(DOC_DIR, refRel), 'utf8').match(refQ) || []).length
}
if (!missingTitle) ok(true, `全部 ${paperCount} 套卷标题都在对应 材料.md 里`)
ok(totalQ === questionCount, `参考答案题目段落总数 = ${questionCount}（实际 ${totalQ}）`)
ok(existsSync(path.join(DOC_DIR, 'README.md')), '根 README.md 总索引存在')
const readme = existsSync(path.join(DOC_DIR, 'README.md')) ? readFileSync(path.join(DOC_DIR, 'README.md'), 'utf8') : ''
ok((readme.match(/\| [^|]+\| \d+ \| \d+ \|/gm) || []).length >= paperCount, 'README 索引行数 ≥ 卷数')

// ── ② 采分点泄漏检查：standards 里所有 ≥8 字符的引号字符串都是指纹
console.log('\n② 采分点泄漏检查')
const stdFiles = existsSync(STANDARDS_DIR)
  ? readdirSync(STANDARDS_DIR).filter((f) => f.endsWith('.js')).map((f) => path.join(STANDARDS_DIR, f))
  : []
const fingerprints = new Set()
for (const f of stdFiles) {
  const s = readFileSync(f, 'utf8')
  for (const m of s.matchAll(/"([^"\n]{8,})"|'([^'\n]{8,})'/g)) {
    fingerprints.add(m[1] || m[2])
  }
}
console.log(`  （从 ${stdFiles.length} 个 standards 文件提取 ${fingerprints.size} 条指纹）`)
const allText = allMd.map((f) => readFileSync(f, 'utf8')).join('\n')
let leaked = []
for (const fp of fingerprints) {
  if (allText.includes(fp)) leaked.push(fp.slice(0, 30))
}
ok(leaked.length === 0, '采分点/标准内容 0 泄漏', leaked.length ? `泄漏样例: ${leaked[0]}` : '')

// ── ③ 公开汇编树不含私有卷年份目录
console.log('\n③ 公开/私有边界')
const privateYears = existsSync(PRIVATE_DIR)
  ? [...new Set(readdirSync(PRIVATE_DIR).map((f) => (f.match(/exam-(\d{4})/) || [])[1]).filter(Boolean))]
  : []
for (const y of privateYears) {
  ok(!rels.some((r) => r.split('/').includes(y)), `公开汇编不含 ${y} 年目录（私有卷）`)
}
if (!privateYears.length) ok(true, '本机无私有卷源，跳过年份边界检查')

// ── ④ 私有汇编只能待在 gitignored 目录
console.log('\n④ 私有汇编位置')
const privDocDir = path.join(ROOT, '私有题库/汇编')
if (existsSync(privDocDir)) {
  const gi = readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  ok(gi.split(/\r?\n/).some((l) => l.trim() === '私有题库/'), '私有汇编所在目录被 .gitignore 整目录盖住')
} else {
  ok(true, '（私有汇编未导出，跳过）')
}

console.log(`\n${'═'.repeat(46)}`)
console.log(`结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
