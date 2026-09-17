// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 题库包签名密钥对：生成 / 查看 / 写入公钥。**作者专用，只在本机跑一次。**
//
// 两个文件的分工：
//   · 私钥 → `.tools/exams/keys/bpq-private.pkcs8.b64`（**已 gitignore，绝不外传**）
//     丢了就再也签不出"旧公钥能验过"的包；泄露了别人就能伪造你的包。
//   · 公钥 → 写进 `frontend/src/bpq/pubkey.js`（进仓库，**本来就该公开**）
//     它的作用只是验证"这个包是用对应私钥签的"。
//
// 用法：
//   node .tools/exams/bpq-keygen.mjs --force      # 首次生成（会覆盖已有私钥）
//   node .tools/exams/bpq-keygen.mjs --append     # 轮换：新密钥 + 保留旧公钥
//
// ⚠️ 用 --force 换密钥前想清楚：**旧公钥一旦从 pubkey.js 里去掉，
//    之前发出去的包就永久验不过签了**（用户手上那些包还在用）。
//    正常轮换请用 --append。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { toB64, keyIdOf } from '../../frontend/src/bpq/crypto.js'

const HERE = import.meta.dirname
const ROOT = path.resolve(HERE, '..', '..')
const KEYS_DIR = path.join(HERE, 'keys')
const PRIVATE_FILE = path.join(KEYS_DIR, 'bpq-private.pkcs8.b64')
const PUBKEY_FILE = path.join(ROOT, 'frontend', 'src', 'bpq', 'pubkey.js')

const argv = process.argv.slice(2)
const force = argv.includes('--force')
const append = argv.includes('--append')

if (existsSync(PRIVATE_FILE) && !force && !append) {
  console.log('私钥已存在：' + path.relative(ROOT, PRIVATE_FILE))
  console.log('换密钥请显式指定：--append（保留旧公钥，推荐）或 --force（丢弃旧公钥，慎用）')
  process.exit(1)
}

const kp = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
)
const privateB64 = toB64(await crypto.subtle.exportKey('pkcs8', kp.privateKey))
const publicB64 = toB64(await crypto.subtle.exportKey('spki', kp.publicKey))
const keyId = await keyIdOf(publicB64)

mkdirSync(KEYS_DIR, { recursive: true })
writeFileSync(PRIVATE_FILE, privateB64 + '\n', 'utf8')

// 公钥：追加模式保留旧公钥（旧包还要靠它验签）
let keys = []
if (append && existsSync(PUBKEY_FILE)) {
  const m = readFileSync(PUBKEY_FILE, 'utf8').match(/BPQ_PUBLIC_KEYS\s*=\s*\[([\s\S]*?)\]/)
  if (m) keys = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}
if (!keys.includes(publicB64)) keys.push(publicB64)

writeFileSync(
  PUBKEY_FILE,
  `// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 题库包验签公钥。**由 .tools/exams/bpq-keygen.mjs 写入，不要手改。**
//
// 这是**公钥**，可以公开：它只能验证"包是不是用对应私钥签的"，签不出包来。
// 对应的私钥在作者本机的 .tools/exams/keys/ 下（已 gitignore，永远不要提交）。
//
// 为什么是数组：换密钥时把新公钥**追加**进来，不要删旧的 ——
// 删掉哪一把，之前发出去的包就再也验不过签了（那些包用户手上还在用）。
export const BPQ_PUBLIC_KEYS = [
${keys.map((k) => '  ' + JSON.stringify(k) + ',').join('\n')}
]
`,
  'utf8',
)

console.log('✓ 已生成签名密钥对')
console.log('  私钥：' + path.relative(ROOT, PRIVATE_FILE) + '   ← 绝不外传，已在 .gitignore')
console.log('  公钥：' + path.relative(ROOT, PUBKEY_FILE) + `（共 ${keys.length} 把）`)
console.log('  公钥指纹：' + keyId)
if (append && keys.length > 1) {
  console.log('  ⚠ 这是轮换：旧的 ' + (keys.length - 1) + ' 把公钥保留着，老包仍可验签。')
}
