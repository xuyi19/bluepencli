// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// .bpq 私有题库包：解析 + 校验 + 入库。
//
// 为什么要有这个格式（而不是让用户直接导入 JSON）：
//   1. 私有真题目的是"作者定向分发"，所以包里带着**颁发者**与**使用者指纹**，
//      泄露时能追到人（水印），这也是与开源部分的分界线；
//   2. 需要一个"认得出、校验得动"的信封 —— 别人手改一个字符，导入时就该报错，
//      而不是塞进题库变成一道读不通的题。
//
// 两种格式并存，导入时自动分辨（按 magic）：
//
//   **v1 · 明文**（`magic: BPQ00001`）
//   { format, magic, version: 1, issuer, issuedAt, license, userFingerprint,
//     tier, yearRange, exams: [...], checksum, checksumAlgo: 'fnv1a32' }
//   校验和 FNV-1a 32 位。它的作用是"防止传输/手改把包弄坏"，**不是防伪造** ——
//   谁都能改完重算一个。已经发出去的包用的是这一版，所以必须继续支持。
//
//   **v2 · 加密 + 签名**（`magic: BPQ00002`）
//   { format, magic, version: 2, issuer, issuedAt, license, userFingerprint,
//     tier, yearRange, examCount, questionCount,
//     crypto: { algo: 'AES-256-GCM', kdf: {…PBKDF2…}, iv, ciphertext },
//     sig:   { algo: 'ECDSA-P256-SHA256', keyId, value } }
//   正文（exams）用**口令派生的密钥**加密，所以包本身外流也读不出内容；
//   外层用**作者私钥签名**，所以能证明"这包确实是作者发的"、且水印改不了。
//   验签在解密**之前**做：伪造的包直接拒掉，不必浪费一次 PBKDF2。
//
// 加解密与签名的实现都在 `./crypto.js`（作者侧脚本 import 同一份，两端不会跑偏）。

// 注意这里带 .js 后缀：Node 的 ESM 不做扩展名补全，
// 而 .tools/verify-bpq.mjs 要直接 import 这个文件做校验（用的就是前端这一份算法）。
import { put, uid, STORES } from '../store/db.js'
import {
  SIG_ALGO,
  decryptPayload,
  signingText,
  stableStringify,
  verifyText,
} from './crypto.js'
import { BPQ_PUBLIC_KEYS } from './pubkey.js'

export const BPQ_FORMAT = 'bluepencil-bpq'
export const BPQ_MAGIC_V1 = 'BPQ00001'
export const BPQ_MAGIC_V2 = 'BPQ00002'
/** @deprecated 旧名，等同 v1 的 magic；保留是为了不破坏已有引用 */
export const BPQ_MAGIC = BPQ_MAGIC_V1

/** 与数据流水线共用的算法（data/daily.js 选每日一练也是它），保证同一份数据两种用途结果一致 */
function fnv1a32(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * 计算校验和（v1 用）。
 * 关键：必须把字段**按键名排序**后序列化 —— 否则 Python 那边和 JS 这边
 * 因为对象键序不同算出两个值，导入就永远失败（踩过一次）。
 */
export function packChecksum(pack) {
  const { checksum, ...rest } = pack
  void checksum
  return fnv1a32(stableStringify(rest))
}

/**
 * 逐卷做最小结构检查：宁可少导入几卷，也不能塞进读不通的题。
 * v1 明文与 v2 解密后共用这一段，保证两条路径的严格程度一致。
 */
function pickUsableExams(rawExams, warnings) {
  const exams = []
  for (const e of rawExams || []) {
    if (!e?.id || !Array.isArray(e.questions) || !e.questions.length) {
      warnings.push(`跳过结构不完整的试卷：${e?.id || '(无 id)'}`)
      continue
    }
    if (typeof e.material !== 'string' || !e.material.trim()) {
      warnings.push(`跳过没有材料的试卷：${e.id}`)
      continue
    }
    exams.push(e)
  }
  return exams
}

function parseJson(text) {
  try {
    return { pack: JSON.parse(text), error: '' }
  } catch {
    return { pack: null, error: '不是合法的 JSON，文件可能损坏或不是题库包' }
  }
}

function wrongFormat() {
  return {
    ok: false,
    sealed: false,
    errors: ['这不是蓝笔申论的题库包（缺少 format/magic 标识）'],
    warnings: [],
    pack: null,
  }
}

/**
 * 解析 v1 明文包并校验。
 * 返回 { ok, sealed, errors, warnings, pack }；errors 非空时不要入库。
 *
 * 遇到 v2 加密包时**不会在这里解密**（解密要口令，得先问用户），
 * 而是返回 `sealed: true`，调用方拿到口令后走 `openSealedPack`。
 */
export function parsePack(text) {
  const warnings = []
  const { pack, error } = parseJson(text)
  if (error) return { ok: false, sealed: false, errors: [error], warnings, pack: null }

  if (pack?.format !== BPQ_FORMAT) return wrongFormat(pack)

  if (pack?.magic === BPQ_MAGIC_V2) {
    return {
      ok: false,
      sealed: true,
      errors: ['这是加密题库包，需要输入口令才能打开'],
      warnings,
      pack: null,
    }
  }
  if (pack?.magic !== BPQ_MAGIC_V1) return wrongFormat(pack)

  const errors = []
  if (!(pack.version <= 1)) {
    errors.push(`题库包版本 ${pack.version} 比当前程序新，请先更新程序`)
  }
  if (!Array.isArray(pack.exams) || !pack.exams.length) {
    errors.push('题库包里没有任何试卷')
  }
  if (pack.checksum && pack.checksum !== packChecksum(pack)) {
    errors.push('校验和不匹配 —— 文件在传输中被改过或损坏了')
  } else if (!pack.checksum) {
    warnings.push('这份题库包没有校验和，来源需自行确认')
  }

  const exams = pickUsableExams(pack.exams, warnings)
  if (!exams.length) errors.push('题库包里的试卷都不可用')

  return { ok: !errors.length, sealed: false, errors, warnings, pack: { ...pack, exams } }
}

/**
 * 用每把公钥挨个试，返回第一把验得过的。
 * `keys` 只在测试里传（用临时密钥自证，不依赖本机私钥是否存在）。
 */
async function verifyWithAnyKey(pack, keys) {
  // 注意区分「没传」和「显式传空」：前者用内置公钥，后者表示"根本没有公钥可用"。
  // 用 `keys?.length ?…` 会把空数组悄悄回退到内置公钥 —— 那样一旦内置公钥为空，
  // 报出来的会是"签名不通过"（误导用户去怀疑包），而不是"程序缺少验签公钥"。
  const list = keys === undefined ? (BPQ_PUBLIC_KEYS || []) : (keys || [])
  if (!list.length) return { ok: false, reason: 'no-key' }
  for (const key of list) {
    const r = await verifyText(signingText(pack), pack?.sig?.value, key)
    if (r.ok) return { ok: true, key }
  }
  return { ok: false, reason: 'bad-signature' }
}

/**
 * 打开 v2 加密包：**先验签，再解密**。
 *
 * 顺序有讲究：验签很便宜，解密要跑 20 万次 PBKDF2（约 0.2s）。
 * 伪造的包在这一步就被拒掉，既省时间，也避免"解密失败"这种含糊的报错
 * 掩盖真正的原因（其实根本不是口令问题，是包不对）。
 */
export async function openSealedPack(text, passphrase, { publicKeys } = {}) {
  const warnings = []
  const { pack, error } = parseJson(text)
  if (error) return { ok: false, sealed: true, errors: [error], warnings, pack: null }
  if (pack?.format !== BPQ_FORMAT || pack?.magic !== BPQ_MAGIC_V2) {
    return { ok: false, sealed: true, errors: ['不是加密题库包'], warnings, pack: null }
  }

  const errors = []
  if (!(pack.version <= 2)) {
    errors.push(`题库包版本 ${pack.version} 比当前程序新，请先更新程序`)
  }
  if (pack.sig?.algo !== SIG_ALGO) {
    errors.push(`不支持的签名算法：${pack.sig?.algo || '(缺失)'}`)
  }

  const sig = await verifyWithAnyKey(pack, publicKeys)
  if (!sig.ok) {
    errors.push(
      sig.reason === 'no-key'
        ? '当前程序没有内置验签公钥，无法确认这个包的来源，已拒绝导入'
        : '签名校验不通过 —— 这个包不是作者签发的，或者内容被人改过',
    )
    return { ok: false, sealed: true, errors, warnings, pack: null }
  }

  let inner = null
  try {
    inner = await decryptPayload(pack.crypto, passphrase)
  } catch {
    // GCM 解不开只有两种可能：口令不对，或密文被动过。签名已经过了，
    // 所以这里几乎一定是口令问题 —— 但口吻别太绝对，给用户两条路都想一想
    errors.push('打开失败：口令不对（也可能是文件被改动过）')
    return { ok: false, sealed: true, errors, warnings, pack: null }
  }

  if (!Array.isArray(inner?.exams) || !inner.exams.length) {
    errors.push('题库包里没有任何试卷')
    return { ok: false, sealed: true, errors, warnings, pack: null }
  }
  // 外层字段是明文，签名已经保证它没被改过；顺手核对一下，作为最后一道 sanity check
  if (pack.examCount && pack.examCount !== inner.exams.length) {
    warnings.push(`包内声明 ${pack.examCount} 套，实际 ${inner.exams.length} 套`)
  }

  const exams = pickUsableExams(inner.exams, warnings)
  if (!exams.length) errors.push('题库包里的试卷都不可用')

  return {
    ok: !errors.length,
    sealed: true,
    errors,
    warnings,
    // 把外层元信息拼回去，入库时水印、颁发者照样能记下来
    pack: {
      ...pack,
      exams,
      checksumAlgo: `${SIG_ALGO}(已验证)`,
      checksum: pack.sig?.keyId || '',
    },
  }
}

/**
 * 入库：把每套卷拆成单题写进 questions 表。
 *
 * 为什么拆成单题而不是建一张"卷"表：
 *   练习页 / 每日一练 / 复盘都已按单题工作，拆开就完全复用现成链路，
 *   一行都不用改。代价是整卷材料在每题里各存一份（2022–2024 共 45 题 × 7KB
 *   ≈ 300KB，一次性写入，可接受）。
 */
export async function importPack(pack, { onProgress } = {}) {
  const stamp = pack.userFingerprint || '未署名'
  const list = []

  for (const e of pack.exams) {
    for (const q of e.questions) {
      list.push({
        // 固定前缀 bpq-，与 real-（内置真题）/ builtin-（仿真）互不冲突
        id: `bpq-${e.id}-${q.no}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        title: q.stem || `第 ${q.no} 题`,
        type: q.type || '',
        exam: `${e.year} 年国考 · ${e.paper}`,
        requirement: q.requirement || '',
        material: e.material,
        reference: q.reference || '',
        maxScore: q.score ?? null,
        wordLimit: q.wordLimit ?? null,
        topics: [],
        kind: '私有',            // 题库页据此标标签、做来源筛选
        builtin: false,          // 可删除
        needLoad: false,
        year: e.year,
        materialChars: e.material.length,
        // 来源与批次：清空重导时能认出来，也留作水印
        _source: 'bpq',
        _packIssuer: pack.issuer || '',
        _packIssuedAt: pack.issuedAt || '',
        _packFingerprint: stamp,
      })
      if (onProgress) onProgress(list.length)
    }
  }

  for (const q of list) {
    await put(STORES.questions, q)
  }

  return {
    questions: list.length,
    exams: pack.exams.length,
    fingerprint: stamp,
    issuer: pack.issuer || '',
    batch: uid(),
  }
}

/**
 * 读取 File → 解析结果（统一入口，UI 只管传 File）。
 *
 * 加密包不回包体，只回 `sealed: true` + `text`：
 * 口令得先问用户，UI 拿到口令再调 openSealedPack。
 */
export async function readPackFile(file) {
  if (!file) throw new Error('没有选择文件')
  if (file.size > 8 * 1024 * 1024) throw new Error('题库包超过 8MB，可能不是题库包')
  const text = await file.text()
  const r = parsePack(text)
  return { ...r, text }
}
