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
// 格式（v1，明文 JSON；AES-256-GCM + ECDSA 签名留给 V2，字段已预留）：
//   {
//     format: 'bluepencil-bpq', magic: 'BPQ00001', version: 1,
//     issuer:  '许一 <xuconghui_03@qq.com>',
//     issuedAt: ISO 时间, license: 使用条款,
//     userFingerprint: 使用者标识（水印，泄露可溯源）,
//     tier: 'private', yearRange: [2022, 2024],
//     exams: [ { id, year, paper, title, material, questions: [...] } ],
//     checksum: '…', checksumAlgo: 'fnv1a32'
//   }
//
// 校验用的是 FNV-1a 32 位，不是签名 —— 它的作用是"防止传输/手改把包弄坏"，
// 不是"防止有人伪造"。真正的防伪靠 V2 的非对称签名。别把这两件事混为一谈。

// 注意这里带 .js 后缀：Node 的 ESM 不做扩展名补全，
// 而 .tools/verify-bpq.mjs 要直接 import 这个文件做校验（用的就是前端这一份算法）。
import { put, uid, STORES } from '../store/db.js'

export const BPQ_MAGIC = 'BPQ00001'
export const BPQ_FORMAT = 'bluepencil-bpq'

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
 * 计算校验和。
 * 关键：必须把字段**按键名排序**后序列化 —— 否则 Python 那边和 JS 这边
 * 因为对象键序不同算出两个值，导入就永远失败（踩过一次）。
 */
export function packChecksum(pack) {
  const { checksum, ...rest } = pack
  void checksum
  return fnv1a32(stableStringify(rest))
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  return '{' + Object.keys(v).sort()
    .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k]))
    .join(',') + '}'
}

/**
 * 解析并校验一个 .bpq 包。
 * 返回 { ok, errors, warnings, pack }；errors 非空时不要入库。
 */
export function parsePack(text) {
  const errors = []
  const warnings = []
  let pack

  try {
    pack = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['不是合法的 JSON，文件可能损坏或不是题库包'], warnings, pack: null }
  }

  if (pack?.format !== BPQ_FORMAT || pack?.magic !== BPQ_MAGIC) {
    return {
      ok: false,
      errors: ['这不是蓝笔申论的题库包（缺少 format/magic 标识）'],
      warnings,
      pack: null,
    }
  }
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

  // 逐卷做最小结构检查：宁可少导入几卷，也不能塞进读不通的题
  const exams = []
  for (const e of pack.exams || []) {
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
  if (!exams.length) errors.push('题库包里的试卷都不可用')

  return { ok: !errors.length, errors, warnings, pack: { ...pack, exams } }
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

/** 读取 File → 文本（统一入口，UI 只管传 File） */
export async function readPackFile(file) {
  if (!file) throw new Error('没有选择文件')
  if (file.size > 8 * 1024 * 1024) throw new Error('题库包超过 8MB，可能不是题库包')
  return parsePack(await file.text())
}
