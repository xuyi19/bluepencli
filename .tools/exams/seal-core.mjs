// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 「把明文包封成加密包」这件事的**唯一实现**。
//
// 为什么必须只有一份：封装要同时做对四件事（派生密钥、加密、算签名、自检回读），
// 而 `seal-bpq.mjs`（手工封一个）和 `issue.mjs`（按批次批量发）都会用到它。
// 各写一份的话，两边的签名覆盖字段一旦有细微差别，
// 症状是"手工封的包能开、批量发的包开不了"——查起来极难定位。
// 所以这里只管封装，命令行怎么传参数、台账怎么记，都不进来。

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  SIG_ALGO,
  decryptPayload,
  encryptPayload,
  keyIdOf,
  signText,
  signingText,
  verifyText,
} from '../../frontend/src/bpq/crypto.js'

export const ROOT = path.resolve(import.meta.dirname, '..', '..')
export const KEYS_DIR = path.join(import.meta.dirname, 'keys')
export const PRIVATE_FILE = path.join(KEYS_DIR, 'bpq-private.pkcs8.b64')
export const PUBKEY_FILE = path.join(ROOT, 'frontend', 'src', 'bpq', 'pubkey.js')
// 私有题库包的落地区（导出 / 封包 / 发放都往这里写）。
// 2026-09-21：从 `release/私有题库/` 挪到**项目根 `私有题库/`**。
// 理由：它原先只是顺带被 `release/` 整目录规则忽略的 —— 私密数据靠别人的规则
// 顺带挡住，是一条随时会断的防线（有人为了提交某个说明文件把 `release/` 改成
// 逐个列，它就静静漏出去了）。挪出来后 `.gitignore` 里有**显式**规则 `私有题库/`。
export const PRIVATE_DEST = path.join(ROOT, '私有题库')

/** 读出内置的验签公钥（数组：轮换密钥时只追加，老包也得能验） */
export function readPubKeys(src = PUBKEY_FILE) {
  if (!existsSync(src)) return []
  const text = readFileSync(src, 'utf8')
  const m = text.match(/BPQ_PUBLIC_KEYS\s*=\s*\[([\s\S]*?)\]/)
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : []
}

/**
 * 明文包（v1）→ 加密包（v2）。纯函数式：给定输入与密钥，产出对象，不碰磁盘。
 *
 * @param {object} plain       v1 明文包（magic 必须是 BPQ00001）
 * @param {string} passphrase  分发口令
 * @param {string} privateKey  base64 PKCS#8 私钥
 * @param {string[]} publicKeys 用于写 keyId 的公钥（第一把为准）
 * @param {object} [override]  覆盖外层字段，目前用来按收件人改水印
 * @returns {Promise<object>}  v2 包对象
 */
export async function sealPack(plain, passphrase, privateKey, publicKeys, override = {}) {
  if (plain.magic !== 'BPQ00001') {
    throw new Error(`需要明文包（magic=BPQ00001），这份是 ${plain.magic}`)
  }
  if (!Array.isArray(plain.exams) || !plain.exams.length) {
    throw new Error('明文包里没有试卷')
  }
  if (!passphrase) throw new Error('必须提供分发口令')

  // 只加密正文：外层留明文，是为了让"这是哪一版、谁的包、多少题"能在解不开时也看得出来
  const cryptoSection = await encryptPayload({ exams: plain.exams }, passphrase)

  const questionCount = plain.exams.reduce((n, e) => n + e.questions.length, 0)
  const out = {
    format: 'bluepencil-bpq',
    magic: 'BPQ00002',
    version: 2,
    issuer: plain.issuer,
    issuedAt: plain.issuedAt,
    license: plain.license,
    userFingerprint: plain.userFingerprint,
    tier: plain.tier,
    yearRange: plain.yearRange,
    examCount: plain.exams.length,
    questionCount,
    crypto: cryptoSection,
    ...override,
  }
  const keyId = publicKeys.length ? await keyIdOf(publicKeys[0]) : '未配置'
  // 签名覆盖除 sig 之外的全部字段（含水印与密文）——改任何一个都验不过
  out.sig = { algo: SIG_ALGO, keyId, value: await signText(signingText(out), privateKey) }
  return out
}

/**
 * 自检：验签 + 用口令回读解密。
 * 发出去之前必须自己先能验能开 —— 包到了用户手上才发现打不开，解释成本极高。
 *
 * @returns {Promise<{signature:boolean, reopened:boolean, exams:number, questions:number}>}
 */
export async function selfCheck(pack, passphrase, publicKeys) {
  const keys = publicKeys?.length ? publicKeys : []
  let signature = false
  for (const key of keys) {
    const r = await verifyText(signingText(pack), pack.sig?.value, key)
    if (r.ok) {
      signature = true
      break
    }
  }
  let reopened = false
  let exams = 0
  let questions = 0
  try {
    const back = await decryptPayload(pack.crypto, passphrase)
    exams = back.exams.length
    questions = back.exams.reduce((n, e) => n + e.questions.length, 0)
    reopened = exams > 0
  } catch {
    reopened = false
  }
  return { signature, reopened, exams, questions, keyId: pack.sig?.keyId }
}

/** 明文包文件名 → 收件人安全的文件名片段 */
export function safeName(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\s/]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60)
}
