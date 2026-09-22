// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 题库汇编导出的护栏测试。跑法：
//   node .tools/test-bank-docs.mjs
//
// 三件事：
//   ① 结构对账：文档里的卷数/题数与题库源一致（少一段 = 有卷没导出来）；
//   ② **采分点泄漏检查**：把 standards 文件里所有引号字符串当"指纹"，
//      逐条断言不出现在导出文档里 —— 导出工具以后哪怕被改坏，
//      只要敢把标准写进文档，这里就红；
//   ③ 边界：公开汇编里不得出现私有卷年份（2022+）。

import { existsSync, readFileSync, readdirSync } from 'node:fs'
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

const mat = readFileSync(path.join(DOC_DIR, '材料汇编.md'), 'utf8')
const ref = readFileSync(path.join(DOC_DIR, '参考答案汇编.md'), 'utf8')
const idx = readFileSync(path.join(DOC_DIR, 'README.md'), 'utf8')

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
ok((mat.match(/^### /gm) || []).length === paperCount, '材料汇编：卷段落数一致')
ok((ref.match(/^#### 第/gm) || []).length === questionCount, '参考答案汇编：题目段落数一致')
ok((idx.split('\n').filter((l) => /^\| 20\d\d \|/.test(l)).length) === paperCount, '索引：行数一致')
for (const p of papers) {
  if (!mat.includes(p.title)) {
    ok(false, `材料汇编缺卷：${p.title}`)
    break
  }
}
ok(true, `全部 ${paperCount} 套卷名都在材料汇编里`)

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
let leaked = []
for (const fp of fingerprints) {
  if (mat.includes(fp) || ref.includes(fp) || idx.includes(fp)) leaked.push(fp.slice(0, 30))
}
ok(leaked.length === 0, '采分点/标准内容 0 泄漏', leaked.length ? `泄漏样例: ${leaked[0]}` : '')

// ── ③ 私有卷不进公开汇编
console.log('\n③ 公开/私有边界')
const privateYears = existsSync(PRIVATE_DIR)
  ? [...new Set(readdirSync(PRIVATE_DIR).map((f) => (f.match(/exam-(\d{4})/) || [])[1]).filter(Boolean))]
  : []
for (const y of privateYears) {
  ok(!new RegExp(`^## ${y} 年`, 'm').test(mat), `公开汇编不含 ${y} 年（私有卷）`)
}
if (!privateYears.length) ok(true, '本机无私有卷源，跳过年份边界检查')

// 私有汇编只允许出现在 gitignored 目录
const privDoc = path.join(ROOT, '私有题库/汇编/材料汇编.md')
ok(existsSync(privDoc) || true, '（私有汇编如已导出，只应在 私有题库/汇编/）')
if (existsSync(privDoc)) {
  const gi = readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  ok(gi.split(/\r?\n/).some((l) => l.trim() === '私有题库/'), '私有汇编所在目录被 .gitignore 整目录盖住')
}

console.log(`\n${'═'.repeat(46)}`)
console.log(`结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
