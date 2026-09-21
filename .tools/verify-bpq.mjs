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
// 加密包（v2）要带上口令才能验到"用户那边打得开"这一层；只验签名的话
// 加 --pubkey 也可以不给口令（签名的公钥在程序里，本机就能验）。
//
// 用法：
//   node .tools/verify-bpq.mjs 私有题库/xxx.bpq
//   node .tools/verify-bpq.mjs 私有题库/xxx-加密.bpq --passphrase "口令"

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

const argv = process.argv.slice(2)
// 显式循环而不是 indexOf：口令里若刚好出现别的参数文本，indexOf 会指到错的位置
let file = ''
let passphrase = ''
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--passphrase') passphrase = argv[++i] || ''
  else if (!argv[i].startsWith('--')) file = argv[i]
}

if (!file) {
  console.error('用法：node .tools/verify-bpq.mjs <文件.bpq> [--passphrase "口令"]')
  process.exit(1)
}

const { parsePack, packChecksum, openSealedPack } = await import(
  new URL('../frontend/src/bpq/importer.js', import.meta.url).href
)

const text = readFileSync(resolve(ROOT, file), 'utf8')
const sizeKb = (Buffer.byteLength(text) / 1024).toFixed(0)
console.log(`文件：${file}`)
console.log(`大小：${sizeKb} KB`)

let r = parsePack(text)
let sealed = false

if (r.sealed) {
  sealed = true
  if (!passphrase) {
    console.error('✗ 这是加密包（v2），要完整校验请加 --passphrase "口令"')
    console.error('  （口令不对时只会看到"打不开"，看不出是包的问题还是口令的问题）')
    process.exit(1)
  }
  r = await openSealedPack(text, passphrase)
}

if (!r.pack) {
  console.error('✗ 校验失败：', r.errors.join('；'))
  process.exit(1)
}

const p = r.pack
const nQ = p.exams.reduce((s, e) => s + e.questions.length, 0)
const chars = p.exams.reduce((s, e) => s + (e.material || '').length, 0)

if (sealed) {
  console.log(`格式：${p.format} / ${p.magic} v${p.version}（AES-256-GCM 加密 + ECDSA 签名）`)
} else {
  console.log(`格式：${p.format} / ${p.magic} v${p.version}  (${p.checksumAlgo})`)
}
console.log(`颁发：${p.issuer}`)
console.log(`时间：${p.issuedAt}`)
console.log(`水印：${p.userFingerprint}`)
console.log(`区间：${p.yearRange?.join('–')}　卷 ${p.exams.length} 套 / 题 ${nQ} 道 ｜ 材料 ${chars} 字`)

if (sealed) {
  console.log('签名：✓ 已通过（公钥在程序内置列表里找到匹配的一把）')
  console.log('解密：✓ 口令正确，正文完整读回')
} else {
  const local = packChecksum(p)
  console.log(`校验：文件内 ${p.checksum} ／ 本地重算 ${local} ${p.checksum === local ? '✓' : '✗'}`)
}
for (const w of r.warnings) console.log(`  ⚠ ${w}`)
for (const e of r.errors) console.log(`  ✗ ${e}`)

console.log(r.ok ? '\n✓ 可以发出去' : '\n✗ 有问题，先修')
process.exit(r.ok ? 0 : 1)
