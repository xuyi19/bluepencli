// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 把明文的 .bpq（v1）封装成**加密 + 签名**的 .bpq（v2）。**作者专用。**
//
// 为什么是两步（export_bpq.py 出明文 → 本脚本封装）：
//   加密与签名要用 WebCrypto，而**浏览器验签也是 WebCrypto**——
//   两端同一套 API，ECDSA 的签名格式天然一致。
//   换成 Python 的 cryptography 就会撞上格式坑：它默认输出 **DER**，
//   而 WebCrypto 要的是 **raw（r‖s）**，验签会一律失败且看不出原因。
//   所以加密这一步留在 Node 侧，零新依赖，也不需要给 backend 加包。
//
// 两步各有各的产物，别搞混：
//   · `…-明文.bpq`  ← export_bpq.py 出的，**只能本机看，绝不能外发**
//   · `…-加密.bpq`  ← 本脚本出的，发给同学的就是这个
//
// 用法（仓库根目录）：
//   node .tools/exams/seal-bpq.mjs --in 私有题库/xxx-明文.bpq --passphrase "口令"
//   node .tools/exams/seal-bpq.mjs --passphrase "口令"        # 自动取最新一份明文包
//   node .tools/exams/seal-bpq.mjs --in ... --check <加密包>  # 只校验一份已有的加密包
//
// 口令怎么给：**不要跟包走同一条路**。包用微信发，口令另说（或者当面说）。
// 两者一起发，等于没加密。

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { signingText, verifyText } from '../../frontend/src/bpq/crypto.js'
import {
  PRIVATE_DEST,
  PRIVATE_FILE,
  ROOT,
  readPubKeys,
  sealPack,
  selfCheck,
} from './seal-core.mjs'

const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 ? argv[i + 1] : undefined
}

const passphrase = arg('passphrase') || process.env.BPQ_PASSPHRASE || ''
const checkFile = arg('check')
// --key 只给测试用（拿临时密钥签名，不碰本机真私钥）
const keyFile = arg('key') || PRIVATE_FILE

/** 只校验：验签 + 解密，确认发出的包在用户那边能打开 */
async function check(file) {
  const pack = JSON.parse(readFileSync(file, 'utf8'))
  // --pubkey 是给测试用的（临时密钥不在 pubkey.js 里）
  const keys = arg('pubkey') ? [arg('pubkey'), ...readPubKeys()] : readPubKeys()
  let sigOk = { ok: false }
  for (const key of keys) {
    sigOk = await verifyText(signingText(pack), pack.sig?.value, key)
    if (sigOk.ok) break
  }
  console.log(`${sigOk.ok ? '✓' : '✗'} 验签（公钥 ${pack.sig?.keyId}）`)
  if (!sigOk.ok) return 1
  if (!passphrase) {
    console.log('· 没给 --passphrase，跳过解密验证')
    return 0
  }
  const r = await selfCheck(pack, passphrase, keys)
  if (r.reopened) {
    console.log(`✓ 解密成功：${r.exams} 套 / ${r.questions} 道题｜水印：${pack.userFingerprint}`)
    return 0
  }
  console.log('✗ 解密失败：口令不对，或者密文被改动过')
  return 1
}

function pickLatestPlain() {
  if (!existsSync(PRIVATE_DEST)) return null
  const files = readdirSync(PRIVATE_DEST)
    .filter((f) => f.endsWith('.bpq') && !f.includes('-加密'))
    .map((f) => path.join(PRIVATE_DEST, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
  return files.length ? files[files.length - 1] : null
}

async function seal() {
  const inFile = arg('in') || pickLatestPlain()
  if (!inFile || !existsSync(inFile)) {
    console.error('找不到明文包。先用 export_bpq.py 生成，或显式 --in <文件>')
    return 1
  }
  if (!existsSync(keyFile)) {
    console.error('没有签名私钥。先跑：node .tools/exams/bpq-keygen.mjs --force')
    return 1
  }
  if (!passphrase) {
    console.error('必须提供分发口令：--passphrase "口令"（或用环境变量 BPQ_PASSPHRASE）')
    return 1
  }

  const plain = JSON.parse(readFileSync(inFile, 'utf8'))
  if (plain.magic !== 'BPQ00001') {
    console.error(`--in 该给明文包（magic=BPQ00001），这份是 ${plain.magic}`)
    return 1
  }
  if (!Array.isArray(plain.exams) || !plain.exams.length) {
    console.error('明文包里没有试卷')
    return 1
  }

  const privateKey = readFileSync(keyFile, 'utf8').trim()
  const pubKeys = readPubKeys()
  // --key 指向临时密钥时，公钥不在 pubkey.js 里，这时用 --pubkey 显式给一把
  const publicKeys = arg('pubkey') ? [arg('pubkey'), ...pubKeys] : pubKeys

  let out
  try {
    out = await sealPack(plain, passphrase, privateKey, publicKeys)
  } catch (err) {
    console.error(String(err?.message || err))
    return 1
  }

  const outFile = arg('out') || path.join(
    path.dirname(inFile),
    path.basename(inFile).replace(/\.bpq$/, '') + '-加密.bpq',
  )
  writeFileSync(outFile, JSON.stringify(out, null, 1), 'utf8')

  // 自检一遍：发出去的包必须自己先能验能开
  const sc = await selfCheck(out, passphrase, publicKeys)

  console.log(`✓ 已封装加密包：${path.relative(ROOT, outFile)}`)
  console.log(`  卷 ${out.examCount} 套 / 题 ${out.questionCount} 道｜年份 ${out.yearRange.join('–')}`)
  console.log(`  使用者水印：${out.userFingerprint}`)
  console.log(`  签名：${out.sig.algo}｜公钥指纹 ${sc.keyId}｜自检 ${sc.signature ? '通过' : '❌ 不通过'}`)
  console.log(`  回读解密：${sc.reopened ? '通过' : '❌ 不通过'}`)
  if (!sc.signature || !sc.reopened) {
    console.error('  ⚠ 自检没过，这份包不要发出去。')
    return 1
  }
  console.log('')
  console.log('  发给对方时：**包用微信发，口令另说一条路**（一起发等于没加密）。')
  console.log(`  明文包（${path.basename(inFile)}）别外发，确认无误后可以删掉。`)
  return 0
}

process.exit(checkFile ? await check(checkFile) : await seal())
