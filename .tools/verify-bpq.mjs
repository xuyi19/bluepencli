// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 校验一个 .bpq 题库包（作者发出去之前自检用）。
//
// 为什么需要它：导出端在 Python、校验端在 JS，两边算校验和的算法必须逐字一致。
// 一旦不一致，用户导入时会一律报"校验和不匹配"——而在本机自测完全是好的。
// 所以发之前先拿这个脚本过一遍，它用的是**和前端完全同一份代码**。
//
// 用法：
//   node .tools/verify-bpq.mjs release/私有题库/xxx.bpq

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const file = process.argv[2]
if (!file) {
  console.error('用法：node .tools/verify-bpq.mjs <文件.bpq>')
  process.exit(1)
}

const { parsePack, packChecksum } = await import(
  new URL('../frontend/src/bpq/importer.js', import.meta.url).href
)

const text = readFileSync(resolve(ROOT, file), 'utf8')
const r = parsePack(text)

console.log(`文件：${file}`)
console.log(`大小：${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`)
if (!r.pack) {
  console.error('✗ 解析失败：', r.errors.join('；'))
  process.exit(1)
}

const p = r.pack
const nQ = p.exams.reduce((s, e) => s + e.questions.length, 0)
const chars = p.exams.reduce((s, e) => s + (e.material || '').length, 0)

console.log(`格式：${p.format} / ${p.magic} v${p.version}  (${p.checksumAlgo})`)
console.log(`颁发：${p.issuer}`)
console.log(`时间：${p.issuedAt}`)
console.log(`水印：${p.userFingerprint}`)
console.log(`区间：${p.yearRange?.join('–')}　卷 ${p.exams.length} 套 / 题 ${nQ} 道 ｜ 材料 ${chars} 字`)
console.log(`校验：文件内 ${p.checksum} ／ 本地重算 ${packChecksum(p)} ` +
  (p.checksum === packChecksum(p) ? '✓' : '✗'))
for (const w of r.warnings) console.log(`  ⚠ ${w}`)
for (const e of r.errors) console.log(`  ✗ ${e}`)

console.log(r.ok ? '\n✓ 可以发出去' : '\n✗ 有问题，先修')
process.exit(r.ok ? 0 : 1)
